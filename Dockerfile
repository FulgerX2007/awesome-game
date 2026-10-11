# syntax=docker/dockerfile:1

# Build a static binary; the web games are embedded into it.
# The build stage runs on the builder's own platform and cross-compiles, so multi-arch images
# don't need to emulate the Go toolchain.
FROM --platform=$BUILDPLATFORM golang:1.24-alpine AS build
ARG TARGETOS
ARG TARGETARCH
ARG VERSION=dev
WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags="-s -w -X main.version=$VERSION" -o /out/awesome-game . \
 && mkdir -p /out/data

# Minimal runtime: no shell, no package manager, runs as an unprivileged user.
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/awesome-game /awesome-game
COPY --from=build --chown=nonroot:nonroot /out/data /data
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["/awesome-game", "-healthcheck"]
ENTRYPOINT ["/awesome-game", "-addr", ":8080", "-data", "/data"]
