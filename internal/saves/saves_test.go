package saves

import (
	"errors"
	"strings"
	"testing"
)

func TestStore(t *testing.T) {
	for name, s := range map[string]*Store{"disk": New(t.TempDir()), "memory": New("")} {
		t.Run(name, func(t *testing.T) {
			const code = "abcdefgh23456789"
			if _, err := s.Get(code); !errors.Is(err, ErrNotFound) {
				t.Fatalf("missing save: err=%v", err)
			}
			if err := s.Put(code, []byte(`{"scrap":5}`)); err != nil {
				t.Fatal(err)
			}
			b, err := s.Get(code)
			if err != nil || string(b) != `{"scrap":5}` {
				t.Fatalf("got %q %v", b, err)
			}
		})
	}
}

func TestValidation(t *testing.T) {
	s := New("")
	for _, code := range []string{"", "short", "../../etc/passwd", "ABCDEFGH23456789", "abcdefgh234567890"} {
		if err := s.Put(code, []byte(`{}`)); !errors.Is(err, ErrBadCode) {
			t.Errorf("code %q accepted: %v", code, err)
		}
	}
	for _, data := range []string{`[1]`, `nope`, `{"a":"` + strings.Repeat("x", MaxSize) + `"}`} {
		if err := s.Put("abcdefgh23456789", []byte(data)); !errors.Is(err, ErrBadData) {
			t.Errorf("data %.20q accepted: %v", data, err)
		}
	}
}
