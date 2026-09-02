package diagnostics

import (
	"sync"
	"testing"
	"time"
)

func TestRequestCounterTracksConcurrentWork(t *testing.T) {
	const requests = 32
	var counter RequestCounter
	ready := sync.WaitGroup{}
	ready.Add(requests)
	release := make(chan struct{})
	done := sync.WaitGroup{}
	done.Add(requests)
	for index := range requests {
		go func() {
			defer done.Done()
			started := counter.Begin()
			ready.Done()
			<-release
			counter.End(started.Add(-time.Duration(index+1)*time.Millisecond), index%2 == 0)
		}()
	}
	ready.Wait()
	inflight := counter.Snapshot()
	if inflight.Total != requests || inflight.Active != requests || inflight.Failures != 0 {
		t.Fatalf("in-flight snapshot: %#v", inflight)
	}
	close(release)
	done.Wait()
	settled := counter.Snapshot()
	if settled.Total != requests || settled.Failures != requests/2 || settled.Active != 0 {
		t.Fatalf("settled snapshot: %#v", settled)
	}
	if settled.AverageMS <= 0 || settled.MaxMS < settled.AverageMS {
		t.Fatalf("duration snapshot: %#v", settled)
	}
}
