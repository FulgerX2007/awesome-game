// Package saves stores opaque JSON game saves on disk, keyed by a random code.
// The code itself is the only credential: whoever knows it can read and overwrite the save.
package saves

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"sync"
)

const MaxSize = 64 << 10

var (
	ErrBadCode  = errors.New("invalid save code")
	ErrBadData  = errors.New("save must be a JSON object under 64 KiB")
	ErrNotFound = errors.New("save not found")
	codeRe      = regexp.MustCompile(`^[a-z0-9]{16}$`)
)

// Store is safe for concurrent use. An empty dir keeps saves in memory only.
type Store struct {
	mu  sync.RWMutex
	dir string
	mem map[string][]byte
}

func New(dir string) *Store { return &Store{dir: dir, mem: map[string][]byte{}} }

func ValidCode(code string) bool { return codeRe.MatchString(code) }

func (s *Store) Get(code string) ([]byte, error) {
	if !ValidCode(code) {
		return nil, ErrBadCode
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.dir == "" {
		if b, ok := s.mem[code]; ok {
			return b, nil
		}
		return nil, ErrNotFound
	}
	b, err := os.ReadFile(filepath.Join(s.dir, code+".json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrNotFound
	}
	return b, err
}

func (s *Store) Put(code string, data []byte) error {
	if !ValidCode(code) {
		return ErrBadCode
	}
	var obj map[string]json.RawMessage
	if len(data) > MaxSize || json.Unmarshal(data, &obj) != nil {
		return ErrBadData
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.dir == "" {
		s.mem[code] = append([]byte(nil), data...)
		return nil
	}
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return err
	}
	path := filepath.Join(s.dir, code+".json")
	if err := os.WriteFile(path+".tmp", data, 0o644); err != nil {
		return err
	}
	return os.Rename(path+".tmp", path)
}
