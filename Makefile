.PHONY: help setup deploy teardown

help:
	@echo "Available commands:"
	@echo "  setup         - Start the local K8s cluster with Minikube. Accepts the following options:"
	@echo "                  Available env vars:"
	@echo "                    OP_LOCAL_REPO_DIR: Path to the local source code (E.g.: OP_LOCAL_REPO_DIR=/path/to/openproject make deploy-dev)"
	@echo "  deploy        - Deploy the integration setup: OpenProject, Nextcloud and Keycloak"
	@echo "  deploy-dev    - Deploy the integration setup in development mode with local OpenProject source code."
	@echo "  teardown      - Delete the integration deployment from the K8s cluster"
	@echo "  teardown-all  - Delete the K8s cluster"

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

setup:
	k3d cluster create opnc -c config/k3d.yaml \
		$(VOL_ARG) --host-alias $(HOST_IP):openproject.test,nextcloud.test,keycloak.test,openproject-assets.test

deploy:
	@helmfile sync

deploy-dev:
	@helmfile sync -e dev

teardown:
	@./scripts/teardown

teardown-all:
	@./scripts/teardown --all
