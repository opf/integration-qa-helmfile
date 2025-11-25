.PHONY: help setup deploy teardown

help:
	@echo "Available commands:"
	@echo "  setup         - Start the local K8s cluster with Minikube. Accepts the following options:"
	@echo "                  Available env vars:"
	@echo "                    LOCAL_SOURCE_PATH: Path to the local source code (E.g.: LOCAL_SOURCE_PATH=/path/to/openproject make deploy-dev)"
	@echo "  deploy        - Deploy the integration setup: OpenProject, Nextcloud and Keycloak"
	@echo "  deploy-dev    - Deploy the integration setup in development mode with local OpenProject source code."
	@echo "  teardown      - Delete the integration deployment from the K8s cluster"
	@echo "  teardown-all  - Delete the K8s cluster"

# resources options
HOST_IP := $(shell hostname -I | awk '{print $$1}')
ifeq ($(strip $(LOCAL_SOURCE_PATH)),)
	VOL_ARG :=
else
	VOL_ARG := -v $(LOCAL_SOURCE_PATH):/localDir
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
