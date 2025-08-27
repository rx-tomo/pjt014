.PHONY: setup build test lint dev format worker worker-refresh supabase-start db-reset gh-bootstrap gh-issues gh-milestones-order

NODE := node
NPM := npm

setup:
	@./scripts/setup.sh

build:
	@./scripts/build.sh

test:
	@./scripts/test.sh

lint:
	@./scripts/lint.sh

format:
	@./scripts/format.sh

dev:
	@./scripts/dev.sh

worker:
	@./scripts/worker.sh

worker-refresh:
	@./scripts/worker_refresh.sh

supabase-start:
	@./scripts/supabase_start.sh

db-reset:
	@./scripts/db_reset.sh

gh-bootstrap:
	@./scripts/gh_bootstrap.sh

gh-issues:
	@./scripts/gh_issues.sh

gh-milestones-order:
	@./scripts/gh_milestones_order.sh

