package leaderboard

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestSubmitRanksAndTrims(t *testing.T) {
	b, err := New(3, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range []int{100, 300, 200} {
		if _, err := b.Submit(Entry{Name: "p", Score: s, Level: 1}); err != nil {
			t.Fatal(err)
		}
	}
	rank, err := b.Submit(Entry{Name: "low", Score: 50, Level: 1})
	if err != nil || rank != 0 {
		t.Fatalf("low score: rank=%d err=%v, want 0,nil", rank, err)
	}
	rank, _ = b.Submit(Entry{Name: "top", Score: 999, Level: 4})
	if rank != 1 {
		t.Fatalf("rank=%d, want 1", rank)
	}
	top := b.Top()
	if len(top) != 3 || top[0].Score != 999 || top[2].Score != 200 {
		t.Fatalf("unexpected board: %+v", top)
	}
}

func TestNormalize(t *testing.T) {
	e, err := Normalize(Entry{Name: "  " + strings.Repeat("я", 40) + " ", Score: 1, Level: 1})
	if err != nil || len([]rune(e.Name)) != MaxNameLen {
		t.Fatalf("name not truncated: %q %v", e.Name, err)
	}
	e, _ = Normalize(Entry{Name: "", Score: 1, Level: 1})
	if e.Name != "Аноним" {
		t.Fatalf("empty name: %q", e.Name)
	}
	bad := []Entry{
		{Name: "x", Score: -1, Level: 1},
		{Name: "x", Score: MaxScore + 1, Level: 1},
		{Name: "x", Score: 1, Level: 0},
		{Name: "a\nb", Score: 1, Level: 1},
	}
	for _, b := range bad {
		if _, err := Normalize(b); err != ErrInvalid {
			t.Errorf("Normalize(%+v) err=%v, want ErrInvalid", b, err)
		}
	}
}

func TestPersistence(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sub", "scores.json")
	b, _ := New(10, path)
	if _, err := b.Submit(Entry{Name: "keep", Score: 42, Level: 2}); err != nil {
		t.Fatal(err)
	}
	b2, err := New(10, path)
	if err != nil {
		t.Fatal(err)
	}
	if top := b2.Top(); len(top) != 1 || top[0].Name != "keep" {
		t.Fatalf("not persisted: %+v", top)
	}
}
