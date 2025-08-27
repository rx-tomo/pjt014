.PHONY: setup dev build start lint test worker supabase-start db-reset

setup:
	corepack enable || true
	@echo "Use Node 22 (nvm use 22)"
	npm i

dev:
	npm run dev

build:
	npm run build

start:
	npm run start

lint:
        npm run lint || true

test:
        npm test

worker:
	npm run worker:dev

supabase-start:
	npm run supabase:start

db-reset:
	npm run db:reset

.PHONY: gh-bootstrap
gh-bootstrap:
	./scripts/gh-bootstrap.sh $$(gh repo view --json nameWithOwner -q .nameWithOwner)

.PHONY: gh-issues
gh-issues:
	./scripts/gh-create-issues.sh $$(gh repo view --json nameWithOwner -q .nameWithOwner)
