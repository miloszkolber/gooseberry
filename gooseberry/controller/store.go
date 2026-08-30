package controller

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

const maxPersistedJSONBytes = 16 * 1024 * 1024

type Store struct {
	Dir string
}

func readStore[T any](s Store, name string, dst *T, validate func(T) error) (bool, error) {
	for _, path := range []string{filepath.Join(s.Dir, name), filepath.Join(s.Dir, name) + ".bak"} {
		raw, _, err := readStoredFile(path)
		if err == nil && decodeStored(raw, dst, validate) == nil {
			return true, nil
		}
	}
	return false, nil
}

func readStoredFile(path string) ([]byte, os.FileMode, error) {
	return readBoundedFile(path, maxPersistedJSONBytes)
}

func openRegularFile(path string, limit int64) (*os.File, os.FileInfo, error) {
	// Reject an existing named pipe or device before opening it.
	info, err := os.Stat(path)
	if err != nil {
		return nil, nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, nil, fmt.Errorf("only regular files can be read")
	}
	if info.Size() > limit {
		return nil, nil, fmt.Errorf("file exceeds the %d-byte limit", limit)
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, nil, err
	}
	info, err = file.Stat()
	if err != nil {
		file.Close()
		return nil, nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > limit {
		file.Close()
		return nil, nil, fmt.Errorf("file changed while opening")
	}
	return file, info, nil
}

func readBoundedFile(path string, limit int64) ([]byte, os.FileMode, error) {
	file, info, err := openRegularFile(path, limit)
	if err != nil {
		return nil, 0, err
	}
	defer file.Close()
	// Use the checked size as a capacity hint without trusting it as the limit.
	// Leave ReadFrom's minimum slack so an EOF probe does not grow a full buffer.
	var buffer bytes.Buffer
	buffer.Grow(int(info.Size()) + bytes.MinRead)
	_, err = buffer.ReadFrom(io.LimitReader(file, limit+1))
	raw := buffer.Bytes()
	if int64(len(raw)) > limit {
		return nil, 0, fmt.Errorf("file grew beyond its %d-byte limit", limit)
	}
	return raw, info.Mode().Perm(), err
}

func decodeStored[T any](raw []byte, dst *T, validate func(T) error) error {
	var candidate T
	if err := json.Unmarshal(raw, &candidate); err != nil {
		return err
	}
	if validate != nil {
		if err := validate(candidate); err != nil {
			return err
		}
	}
	*dst = candidate
	return nil
}

func writeStore[T any](s Store, name string, value T, validate func(T) error) error {
	serialized, err := json.MarshalIndent(value, "", "\t")
	if err != nil {
		return fmt.Errorf("encode %s: %w", name, err)
	}
	serialized = append(serialized, '\n')
	if len(serialized) > maxPersistedJSONBytes {
		return fmt.Errorf("persisted JSON exceeds the %d-byte limit", maxPersistedJSONBytes)
	}
	var checked T
	if err := decodeStored(serialized, &checked, validate); err != nil {
		return fmt.Errorf("invalid persisted shape for %s: %w", name, err)
	}

	target := filepath.Join(s.Dir, name)
	directoryPath := filepath.Dir(target)
	if err := os.MkdirAll(directoryPath, 0o700); err != nil {
		return err
	}
	old, mode, readErr := readStoredFile(target)
	if readErr == nil && decodeStored(old, &checked, validate) == nil {
		if err := atomicReplace(target+".bak", old, mode); err != nil {
			return err
		}
	} else {
		mode = 0o600
	}
	if err := atomicReplace(target, serialized, mode); err != nil {
		return err
	}
	directory, err := os.Open(directoryPath)
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}

func atomicReplace(target string, data []byte, mode os.FileMode) error {
	temporary, err := os.CreateTemp(filepath.Dir(target), "."+filepath.Base(target)+".*.tmp")
	if err != nil {
		return err
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	if err := temporary.Chmod(mode); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(data); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryName, target)
}
