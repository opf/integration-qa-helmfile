.PHONY: help
help:
	@echo "Available commands:"
	@echo "  setup                 - Start the local K8s cluster with k3d. Accepts the following options:"
	@echo "                          Available env vars:"
	@echo "                            OP_LOCAL_REPO_DIR: Path to the local source code (E.g.: OP_LOCAL_REPO_DIR=/path/to/openproject make deploy-dev)"
	@echo "  deploy                - Deploy the integration setup: OpenProject, Nextcloud and Keycloak"
	@echo "  deploy-dev            - Deploy the integration setup in development mode with local OpenProject source code"
	@echo "  deploy-op-standalone  - Deploy OpenProject standalone in development mode with local source code"
	@echo "  rails-console         - Open a Rails console session"
	@echo "  run-rspec-test        - Run OpenProject RSpec tests"
	@echo "                            Usage: make run-rspec-test SPEC=spec/features/auth/login_spec.rb"
	@echo "  run-rake-task         - Run rake tasks in the OpenProject container"
	@echo "                            Usage: make run-rake-task db:seed db:migrate"
	@echo "  teardown              - Delete the integration deployment from the K8s cluster"
	@echo "  teardown-all          - Delete the K8s cluster"

PLATFORM := $(shell uname)
ifeq ($(PLATFORM),Darwin)
	HOST_IP := $(shell ipconfig getifaddr en0)
else
	HOST_IP := $(shell hostname -I | awk '{print $$1}')
endif

ifeq ($(strip $(OP_LOCAL_REPO_DIR)),)
	VOL_ARG :=
else
	VOL_ARG := -v $(OP_LOCAL_REPO_DIR):/localDir/openproject
endif

.PHONY: setup
setup:
	k3d cluster create opnc -c config/k3d.yaml \
		$(VOL_ARG) --host-alias $(HOST_IP):openproject.test,nextcloud.test,keycloak.test,openproject-assets.test

.PHONY: deploy
deploy:
	@helmfile sync

.PHONY: deploy-dev
deploy-dev:
	@helmfile sync -e dev

.PHONY: deploy-op-standalone
deploy-op-standalone:
	@helmfile sync -e dev-op-standalone

.PHONY: rails-console
rails-console:
	@kubectl exec -n opnc-integration -it deploy/openproject-web -- bash -c 'cd $$APP_PATH && bundle exec rails console'

.PHONY: run-rspec-test
run-rspec-test:
	@if [ -z "$(SPEC)" ]; then \
		echo "Error: SPEC is not provided. Usage: make run-rspec-test SPEC=spec/features/auth/login_spec.rb"; \
		exit 1; \
	fi
	@kubectl exec -n opnc-integration deploy/op-test-container -- bash -c 'cd $$APP_PATH && RAILS_ENV=test bundle exec rspec $(SPEC) && rm -rf tmp/cache/assets'

.PHONY: run-rake-task
run-rake-task: TASK_ARGS = $(filter-out $@,$(MAKECMDGOALS))
run-rake-task:
	@kubectl exec -n opnc-integration deploy/openproject-web -- bash -c 'cd $$APP_PATH && bundle exec rake $(TASK_ARGS)'

.PHONY: teardown
teardown:
	@./scripts/teardown

.PHONY: teardown-all
teardown-all:
	@./scripts/teardown --all
