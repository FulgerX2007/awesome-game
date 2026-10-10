// Command awesome-game serves the browser games and their small APIs.
package main

import (
	"embed"
	"encoding/json"
	"errors"
	"flag"
	"io"
	"io/fs"
	"log"
	"net/http"
	"path/filepath"
	"time"

	"github.com/fulgerx2007/awesome-game/internal/leaderboard"
	"github.com/fulgerx2007/awesome-game/internal/saves"
)

//go:embed web
var webFS embed.FS

func main() {
	addr := flag.String("addr", ":8080", "listen address")
	dataDir := flag.String("data", "data", "directory for leaderboards and saves (empty = in-memory)")
	flag.Parse()

	inData := func(name string) string {
		if *dataDir == "" {
			return ""
		}
		return filepath.Join(*dataDir, name)
	}
	boards, err := newBoards(inData)
	if err != nil {
		log.Fatalf("load leaderboards: %v", err)
	}

	srv := &http.Server{
		Addr:              *addr,
		Handler:           newMux(boards, saves.New(inData("saves"))),
		ReadHeaderTimeout: 5 * time.Second,
	}
	log.Printf("игры: http://localhost%s", *addr)
	log.Fatal(srv.ListenAndServe())
}

// Games with a leaderboard; anything else under /api/boards/ is a 404.
var boardGames = []string{"echo", "valley"}

func newBoards(path func(string) string) (map[string]*leaderboard.Board, error) {
	boards := make(map[string]*leaderboard.Board, len(boardGames))
	for _, g := range boardGames {
		b, err := leaderboard.New(10, path("scores-"+g+".json"))
		if err != nil {
			return nil, err
		}
		boards[g] = b
	}
	return boards, nil
}

func newMux(boards map[string]*leaderboard.Board, store *saves.Store) *http.ServeMux {
	static, err := fs.Sub(webFS, "web")
	if err != nil {
		panic(err)
	}
	mux := http.NewServeMux()
	mux.Handle("GET /", http.FileServer(http.FS(static)))
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte("ok"))
	})
	boardFor := func(w http.ResponseWriter, r *http.Request) *leaderboard.Board {
		b, ok := boards[r.PathValue("game")]
		if !ok {
			http.Error(w, "unknown game", http.StatusNotFound)
		}
		return b
	}
	mux.HandleFunc("GET /api/boards/{game}/scores", func(w http.ResponseWriter, r *http.Request) {
		if board := boardFor(w, r); board != nil {
			writeJSON(w, http.StatusOK, board.Top())
		}
	})
	mux.HandleFunc("POST /api/boards/{game}/scores", func(w http.ResponseWriter, r *http.Request) {
		board := boardFor(w, r)
		if board == nil {
			return
		}
		var e leaderboard.Entry
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&e); err != nil {
			http.Error(w, "bad json", http.StatusBadRequest)
			return
		}
		e.At = time.Time{} // server decides the timestamp
		rank, err := board.Submit(e)
		if errors.Is(err, leaderboard.ErrInvalid) {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if err != nil {
			log.Printf("submit score: %v", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"rank": rank, "top": board.Top()})
	})
	mux.HandleFunc("GET /api/saves/{code}", func(w http.ResponseWriter, r *http.Request) {
		data, err := store.Get(r.PathValue("code"))
		switch {
		case errors.Is(err, saves.ErrBadCode):
			http.Error(w, err.Error(), http.StatusBadRequest)
		case errors.Is(err, saves.ErrNotFound):
			http.Error(w, err.Error(), http.StatusNotFound)
		case err != nil:
			log.Printf("load save: %v", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
		default:
			w.Header().Set("Content-Type", "application/json")
			w.Write(data)
		}
	})
	mux.HandleFunc("PUT /api/saves/{code}", func(w http.ResponseWriter, r *http.Request) {
		data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, saves.MaxSize+1))
		if err != nil {
			http.Error(w, saves.ErrBadData.Error(), http.StatusRequestEntityTooLarge)
			return
		}
		err = store.Put(r.PathValue("code"), data)
		switch {
		case errors.Is(err, saves.ErrBadCode), errors.Is(err, saves.ErrBadData):
			http.Error(w, err.Error(), http.StatusBadRequest)
		case err != nil:
			log.Printf("store save: %v", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
		default:
			w.WriteHeader(http.StatusNoContent)
		}
	})
	return mux
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
