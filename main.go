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
	"time"

	"github.com/fulgerx2007/awesome-game/internal/leaderboard"
	"github.com/fulgerx2007/awesome-game/internal/saves"
)

//go:embed web
var webFS embed.FS

func main() {
	addr := flag.String("addr", ":8080", "listen address")
	dataPath := flag.String("data", "data/scores.json", "ЭХО leaderboard file (empty = in-memory)")
	savesDir := flag.String("saves", "data/saves", "Ржавый рассвет cloud saves dir (empty = in-memory)")
	flag.Parse()

	board, err := leaderboard.New(10, *dataPath)
	if err != nil {
		log.Fatalf("load leaderboard: %v", err)
	}

	srv := &http.Server{
		Addr:              *addr,
		Handler:           newMux(board, saves.New(*savesDir)),
		ReadHeaderTimeout: 5 * time.Second,
	}
	log.Printf("игры: http://localhost%s", *addr)
	log.Fatal(srv.ListenAndServe())
}

func newMux(board *leaderboard.Board, store *saves.Store) *http.ServeMux {
	static, err := fs.Sub(webFS, "web")
	if err != nil {
		panic(err)
	}
	mux := http.NewServeMux()
	mux.Handle("GET /", http.FileServer(http.FS(static)))
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte("ok"))
	})
	mux.HandleFunc("GET /api/scores", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, board.Top())
	})
	mux.HandleFunc("POST /api/scores", func(w http.ResponseWriter, r *http.Request) {
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
