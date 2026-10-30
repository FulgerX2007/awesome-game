// Command awesome-game serves the browser games and their small APIs.
package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/fulgerx2007/awesome-game/internal/leaderboard"
	"github.com/fulgerx2007/awesome-game/internal/saves"
)

//go:embed web
var webFS embed.FS

// version is set at build time (-ldflags "-X main.version=v1.2.3"); release images carry the git tag.
var version = "dev"

func main() {
	addr := flag.String("addr", ":8080", "listen address")
	dataDir := flag.String("data", "data", "directory for leaderboards and saves (empty = in-memory)")
	healthcheck := flag.Bool("healthcheck", false, "probe /healthz of a server on -addr and exit (for container health checks)")
	showVersion := flag.Bool("version", false, "print the version and exit")
	flag.Parse()

	if *showVersion {
		fmt.Println(version)
		return
	}
	if *healthcheck {
		os.Exit(probe(*addr))
	}

	inData := func(name string) string {
		if *dataDir == "" {
			return ""
		}
		return filepath.Join(*dataDir, name)
	}
	if *dataDir != "" {
		if err := checkWritable(*dataDir); err != nil {
			// Keep serving: the games work without the server, only scores and cloud saves need the disk.
			log.Printf("ВНИМАНИЕ: каталог данных %s недоступен на запись: %v", *dataDir, err)
			log.Printf("рекорды и облачные сохранения не будут записываться; процесс работает как uid %d gid %d", os.Getuid(), os.Getgid())
			log.Printf("выдайте права на каталог (chown -R %d:%d <папка>) или запустите контейнер от владельца папки (user: \"UID:GID\")", os.Getuid(), os.Getgid())
		}
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

	// Stop cleanly on Ctrl+C or `docker stop` so in-flight writes finish.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		srv.Shutdown(shutdown)
	}()

	log.Printf("игры %s: http://localhost%s", version, *addr)
	if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
	log.Print("остановлен")
}

// probe returns 0 when the server on addr answers /healthz, 1 otherwise.
// checkWritable makes sure dir exists and files can be created in it, the same way the stores write.
func checkWritable(dir string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	f, err := os.CreateTemp(dir, ".write-check-*")
	if err != nil {
		return err
	}
	name := f.Name()
	f.Close()
	return os.Remove(name)
}

func probe(addr string) int {
	_, port, err := net.SplitHostPort(addr)
	if err != nil {
		return 1
	}
	client := http.Client{Timeout: 2 * time.Second}
	res, err := client.Get("http://127.0.0.1:" + port + "/healthz")
	if err != nil {
		return 1
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}

// Games with a leaderboard; anything else under /api/boards/ is a 404.
var boardGames = []string{"echo", "valley", "wonders", "bastion", "castle"}

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
	mux.Handle("GET /", noCache(static, precompressed(static, http.FileServer(http.FS(static)))))
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

// noCache makes browsers and proxies revalidate static files on every load, so a new release
// shows up without a hard refresh. Each file gets a content-hash ETag, so an unchanged file
// costs only a 304 (http.FileServer honours If-None-Match once the ETag header is set).
func noCache(files fs.FS, next http.Handler) http.Handler {
	etags := map[string]string{}
	fs.WalkDir(files, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		data, err := fs.ReadFile(files, path)
		if err != nil {
			return err
		}
		sum := sha256.Sum256(data)
		etags[path] = `"` + hex.EncodeToString(sum[:8]) + `"`
		return nil
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(r.URL.Path, "/")
		if name == "" || strings.HasSuffix(name, "/") {
			name += "index.html"
		}
		if tag, ok := etags[name]; ok {
			w.Header().Set("ETag", tag)
		}
		w.Header().Set("Cache-Control", "no-cache")
		next.ServeHTTP(w, r)
	})
}

// precompressed serves name from name.gz when only the gzipped file is embedded. The Godot engine
// (web/godot/engine.wasm, ~40 MB, shared by the Godot games) is stored that way: a quarter of the size in the repository,
// the binary and on the wire. Browsers get the gzip bytes as they are; a client that does not accept
// gzip gets them unpacked on the fly.
func precompressed(files fs.FS, next http.Handler) http.Handler {
	type gzFile struct {
		data []byte
		etag string
	}
	gz := map[string]gzFile{}
	fs.WalkDir(files, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".gz") {
			return err
		}
		if _, err := fs.Stat(files, strings.TrimSuffix(path, ".gz")); err == nil {
			return nil // the plain file is there too: serve it as it is
		}
		data, err := fs.ReadFile(files, path)
		if err != nil {
			return err
		}
		sum := sha256.Sum256(data)
		gz[strings.TrimSuffix(path, ".gz")] = gzFile{data, `"` + hex.EncodeToString(sum[:8]) + `-gz"`}
		return nil
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f, ok := gz[strings.TrimPrefix(r.URL.Path, "/")]
		if !ok {
			next.ServeHTTP(w, r)
			return
		}
		h := w.Header()
		h.Add("Vary", "Accept-Encoding")
		if ct := mime.TypeByExtension(filepath.Ext(r.URL.Path)); ct != "" {
			h.Set("Content-Type", ct)
		}
		if !acceptsGzip(r) {
			h.Del("ETag")
			zr, err := gzip.NewReader(bytes.NewReader(f.data))
			if err != nil {
				http.Error(w, "internal error", http.StatusInternalServerError)
				return
			}
			io.Copy(w, zr)
			return
		}
		h.Set("ETag", f.etag)
		h.Set("Content-Encoding", "gzip")
		http.ServeContent(w, r, "", time.Time{}, bytes.NewReader(f.data))
	})
}

func acceptsGzip(r *http.Request) bool {
	for _, part := range strings.Split(r.Header.Get("Accept-Encoding"), ",") {
		enc, q, _ := strings.Cut(strings.TrimSpace(part), ";")
		if strings.EqualFold(strings.TrimSpace(enc), "gzip") && strings.ReplaceAll(strings.TrimSpace(q), " ", "") != "q=0" {
			return true
		}
	}
	return false
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
