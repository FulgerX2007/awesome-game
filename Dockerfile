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
# Assemble the whole runtime filesystem here, so the final image is a single layer.
# The server makes no outbound TLS calls and uses no time zones, so it needs no CA bundle or tzdata.
RUN mkdir -p /rootfs/etc /rootfs/data \
 && CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags="-s -w -X main.version=$VERSION" -o /rootfs/awesome-game . \
 && echo 'nonroot:x:65532:65532:nonroot:/data:/sbin/nologin' > /rootfs/etc/passwd \
 && echo 'nonroot:x:65532:' > /rootfs/etc/group \
 && chown 65532:65532 /rootfs/data

# Minimal runtime: one layer, no shell, no package manager, runs as an unprivileged user (uid 65532).
FROM scratch
COPY --from=build /rootfs /
USER 65532:65532
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["/awesome-game", "-healthcheck"]
ENTRYPOINT ["/awesome-game", "-addr", ":8080", "-data", "/data"]
