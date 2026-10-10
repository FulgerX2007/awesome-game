// Command awesome-game serves the "ЭХО" browser game and its leaderboard API.
package main

import (
	"embed"
	"encoding/json"
	"errors"
	"flag"
	"io/fs"
	"log"
	"net/http"
	"time"

	"github.com/fulgerx2007/awesome-game/internal/leaderboard"
)

//go:embed web
var webFS embed.FS

func main() {
	addr := flag.String("addr", ":8080", "listen address")
	dataPath := flag.String("data", "data/scores.json", "leaderboard file (empty = in-memory)")
	flag.Parse()

	board, err := leaderboard.New(10, *dataPath)
	if err != nil {
		log.Fatalf("load leaderboard: %v", err)
	}

	srv := &http.Server{
		Addr:              *addr,
		Handler:           newMux(board),
		ReadHeaderTimeout: 5 * time.Second,
	}
	log.Printf("ЭХО: http://localhost%s", *addr)
	log.Fatal(srv.ListenAndServe())
}

func newMux(board *leaderboard.Board) *http.ServeMux {
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
	return mux
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
