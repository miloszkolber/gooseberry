from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path, PurePosixPath

REPO = Path.cwd()
CODE = REPO / "mewa-code"
ROOTS = [CODE / "apps", CODE / "packages", CODE / "webui", CODE / "scripts"]
SKIP_DIRS = {"node_modules", "dist", ".git", "coverage"}
CODE_SUFFIXES = {".ts", ".tsx"}
TEXT_SUFFIXES = {
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".jsonc", ".md",
    ".yml", ".yaml", ".toml", ".css", ".html", ".sh", ".txt",
}


def kebab(value: str) -> str:
    value = value.replace("_", "-").replace(" ", "-")
    value = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1-\2", value)
    value = re.sub(r"([a-z0-9])([A-Z])", r"\1-\2", value)
    value = re.sub(r"-+", "-", value)
    return value.lower().strip("-")


def file_name_to_kebab(name: str) -> str:
    # Convert every semantic segment while preserving suffix chains such as .test.tsx and .d.ts.
    parts = name.split(".")
    if len(parts) == 1:
        return kebab(name)
    return ".".join(kebab(part) for part in parts)


def should_skip(path: Path) -> bool:
    return any(part in SKIP_DIRS for part in path.parts)


def transformed_path(path: Path) -> Path:
    rel = path.relative_to(CODE)
    parts = list(rel.parts)
    converted: list[str] = []
    for index, part in enumerate(parts):
        if index == len(parts) - 1:
            converted.append(file_name_to_kebab(part))
        else:
            converted.append(kebab(part))
    return CODE.joinpath(*converted)


def find_source_files() -> list[Path]:
    files: list[Path] = []
    for root in ROOTS:
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if path.is_file() and path.suffix in CODE_SUFFIXES and not should_skip(path):
                files.append(path)
    return sorted(files)


def resolve_module(old_source: Path, value: str, old_files: set[Path]) -> tuple[Path | None, str]:
    """Resolve a source string literal to an old TS/TSX file.

    Returns (target, mode), where mode records whether the original specifier omitted the
    extension and/or selected an index file through a directory path.
    """
    if value.startswith("@/"):
        base = CODE / "webui" / "src"
        raw = value[2:]
        alias = True
    elif value.startswith("./") or value.startswith("../"):
        base = old_source.parent
        raw = value
        alias = False
    else:
        return None, ""

    # Ignore URLs, query/hash suffixes, and obvious non-module patterns.
    if any(token in raw for token in ("*", "?", "#")):
        return None, ""

    path = (base / raw).resolve(strict=False)
    # Existing explicit TS/TSX extension.
    if path.suffix in CODE_SUFFIXES and path in old_files:
        return path, "alias-explicit" if alias else "relative-explicit"

    # JS extension may refer to a TS source under NodeNext-style imports.
    if path.suffix in {".js", ".jsx", ".mjs", ".cjs"}:
        for ext in CODE_SUFFIXES:
            candidate = path.with_suffix(ext)
            if candidate in old_files:
                return candidate, ("alias-js" if alias else "relative-js")

    # Extensionless file.
    if not path.suffix:
        for ext in (".ts", ".tsx"):
            candidate = Path(f"{path}{ext}")
            if candidate in old_files:
                return candidate, ("alias-extensionless" if alias else "relative-extensionless")
        # Directory barrel.
        for name in ("index.ts", "index.tsx"):
            candidate = path / name
            if candidate in old_files:
                return candidate, ("alias-index" if alias else "relative-index")

    return None, ""


def render_specifier(new_source: Path, new_target: Path, mode: str) -> str:
    alias = mode.startswith("alias-")
    detail = mode.split("-", 1)[1]
    if alias:
        alias_root = CODE / "webui" / "src"
        rendered = new_target.relative_to(alias_root).as_posix()
    else:
        rendered = os.path.relpath(new_target, new_source.parent).replace(os.sep, "/")
        if not rendered.startswith("."):
            rendered = f"./{rendered}"

    if detail == "index":
        rendered = rendered.rsplit("/index.", 1)[0] if "/index." in rendered else rendered
    elif detail == "extensionless":
        rendered = re.sub(r"\.(?:ts|tsx)$", "", rendered)
    elif detail == "js":
        rendered = re.sub(r"\.(?:ts|tsx)$", ".js", rendered)
    # explicit preserves the new .ts/.tsx extension.

    return f"@/{rendered}" if alias else rendered


def update_string_literals(path: Path, old_path: Path, mapping: dict[Path, Path], old_files: set[Path]) -> bool:
    try:
        text = path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return False

    # Covers import/export/require/mock/new URL and other path-bearing string literals without
    # rewriting symbol identifiers or prose. Escaped quotes are deliberately excluded.
    pattern = re.compile(r"(?P<quote>['\"])(?P<value>(?:\\.|(?!\1).)*?)(?P=quote)")
    changed = False

    def replace(match: re.Match[str]) -> str:
        nonlocal changed
        value = match.group("value")
        target, mode = resolve_module(old_path, value, old_files)
        if target is None or target not in mapping:
            return match.group(0)
        new_value = render_specifier(path, mapping[target], mode)
        if new_value == value:
            return match.group(0)
        changed = True
        quote = match.group("quote")
        return f"{quote}{new_value}{quote}"

    updated = pattern.sub(replace, text)

    # Update explicit repository-relative paths in config, docs, and shell scripts.
    for old, new in sorted(mapping.items(), key=lambda item: len(item[0].as_posix()), reverse=True):
        old_repo = old.relative_to(REPO).as_posix()
        new_repo = new.relative_to(REPO).as_posix()
        if old_repo in updated:
            updated = updated.replace(old_repo, new_repo)
            changed = True
        old_code = old.relative_to(CODE).as_posix()
        new_code = new.relative_to(CODE).as_posix()
        if old_code in updated:
            updated = updated.replace(old_code, new_code)
            changed = True

    if changed:
        path.write_text(updated, encoding="utf-8")
    return changed


def main() -> None:
    files = find_source_files()
    mapping = {path.resolve(): transformed_path(path).resolve() for path in files}
    mapping = {old: new for old, new in mapping.items() if old != new}

    targets = list(mapping.values())
    if len(targets) != len(set(targets)):
        duplicates = sorted({target for target in targets if targets.count(target) > 1})
        raise SystemExit(f"filename normalization collision: {duplicates}")
    for old, new in mapping.items():
        if new.exists() and new not in mapping:
            raise SystemExit(f"target already exists: {new.relative_to(REPO)}")

    old_files = {path.resolve() for path in files}

    # Move deepest paths first. Full file-path moves also normalize any camel-cased directory.
    for old, new in sorted(mapping.items(), key=lambda item: len(item[0].parts), reverse=True):
        new.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "mv", str(old.relative_to(REPO)), str(new.relative_to(REPO))], check=True)

    inverse = {new: old for old, new in mapping.items()}
    text_files: list[Path] = []
    for path in REPO.rglob("*"):
        if not path.is_file() or should_skip(path):
            continue
        if path.suffix in TEXT_SUFFIXES or path.name in {"Dockerfile", "Makefile"}:
            text_files.append(path.resolve())

    changed_refs = 0
    for path in text_files:
        old_path = inverse.get(path, path)
        if update_string_literals(path, old_path, mapping, old_files):
            changed_refs += 1

    # Remove now-empty normalized source directories.
    for root in ROOTS:
        if not root.exists():
            continue
        for directory in sorted((p for p in root.rglob("*") if p.is_dir()), key=lambda p: len(p.parts), reverse=True):
            try:
                directory.rmdir()
            except OSError:
                pass

    print(f"renamed {len(mapping)} TypeScript files; updated references in {changed_refs} files")


if __name__ == "__main__":
    main()
