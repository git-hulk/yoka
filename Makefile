# yoka — build the UI into the API server.
#
#   make build   build frontend/dist (served by the API at /web) + release binary
#   make web     frontend dist only
#   make server  release binary only
#   make run     build the UI, then serve everything from the API server:
#                UI at http://127.0.0.1:3000/web, API at /api (and bare paths)

.PHONY: build web server run

build: web server

web:
	cd frontend && npm run build

server:
	cd backend && cargo build --release

run: web
	cd backend && cargo run
