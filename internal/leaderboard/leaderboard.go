// Package leaderboard keeps a bounded, persisted top-N list of game scores.
package leaderboard

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	MaxNameLen = 16
	MaxScore   = 10_000_000
	MaxLevel   = 1000
)

var ErrInvalid = errors.New("invalid entry")

type Entry struct {
	Name  string    `json:"name"`
	Score int       `json:"score"`
	Level int       `json:"level"`
	At    time.Time `json:"at"`
}

// Board is safe for concurrent use. If path is empty, nothing is persisted.
type Board struct {
	mu      sync.RWMutex
	size    int
	path    string
	entries []Entry
}

func New(size int, path string) (*Board, error) {
	b := &Board{size: size, path: path}
	if path == "" {
		return b, nil
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return b, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(data, &b.entries); err != nil {
		return nil, err
	}
	b.sortAndTrim()
	return b, nil
}

// Normalize trims and validates an entry; it returns ErrInvalid on bad input.
func Normalize(e Entry) (Entry, error) {
	e.Name = strings.TrimSpace(e.Name)
	if e.Name == "" {
		e.Name = "Аноним"
	}
	if utf8.RuneCountInString(e.Name) > MaxNameLen {
		e.Name = string([]rune(e.Name)[:MaxNameLen])
	}
	for _, r := range e.Name {
		if r < 0x20 || r == 0x7f {
			return Entry{}, ErrInvalid
		}
	}
	if e.Score < 0 || e.Score > MaxScore || e.Level < 1 || e.Level > MaxLevel {
		return Entry{}, ErrInvalid
	}
	return e, nil
}

// Submit adds an entry and returns its 1-based rank, or 0 if it did not make the board.
func (b *Board) Submit(e Entry) (int, error) {
	e, err := Normalize(e)
	if err != nil {
		return 0, err
	}
	if e.At.IsZero() {
		e.At = time.Now().UTC()
	}

	b.mu.Lock()
	defer b.mu.Unlock()
	b.entries = append(b.entries, e)
	b.sortAndTrim()

	rank := 0
	for i, x := range b.entries {
		if x == e {
			rank = i + 1
			break
		}
	}
	if rank == 0 {
		return 0, nil
	}
	return rank, b.save()
}

func (b *Board) Top() []Entry {
	b.mu.RLock()
	defer b.mu.RUnlock()
	out := make([]Entry, len(b.entries))
	copy(out, b.entries)
	return out
}

func (b *Board) sortAndTrim() {
	sort.SliceStable(b.entries, func(i, j int) bool {
		if b.entries[i].Score != b.entries[j].Score {
			return b.entries[i].Score > b.entries[j].Score
		}
		return b.entries[i].At.Before(b.entries[j].At)
	})
	if len(b.entries) > b.size {
		b.entries = b.entries[:b.size]
	}
}

// save writes atomically via temp file + rename. Caller holds b.mu.
func (b *Board) save() error {
	if b.path == "" {
		return nil
	}
	data, err := json.MarshalIndent(b.entries, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(b.path), 0o755); err != nil {
		return err
	}
	tmp := b.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, b.path)
}
