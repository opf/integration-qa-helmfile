#!/bin/bash

# Don't exit on error immediately
set +e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
NAMESPACE="opnc-integration"
SETUP_METHODS=("oauth2" "sso-nextcloud" "sso-external")
CONFIG_FILE="environments/default/config.yaml"
REPORTS_DIR="e2e/reports"
E2E_DIR="e2e"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Track results (using string-based storage for bash 3.2 compatibility)
RESULTS_DATA=""
REPORT_PATHS_DATA=""

# Helper functions for storing/retrieving results (bash 3.2 compatible)
set_result() {
    local method=$1
    local result=$2
    RESULTS_DATA="${RESULTS_DATA}${method}:${result}|"
}

get_result() {
    local method=$1
    echo "$RESULTS_DATA" | grep -o "${method}:[^|]*" | cut -d: -f2
}

set_report_path() {
    local method=$1
    local path=$2
    REPORT_PATHS_DATA="${REPORT_PATHS_DATA}${method}:${path}|"
}

get_report_path() {
    local method=$1
    echo "$REPORT_PATHS_DATA" | grep -o "${method}:[^|]*" | cut -d: -f2
}

# Change to project root
cd "$PROJECT_ROOT"

# Logging functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1" >&2
}

log_step() {
    echo -e "\n${GREEN}[STEP]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_command() {
    echo -e "${YELLOW}[CMD]${NC} $(date '+%Y-%m-%d %H:%M:%S') - Executing: $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_failure() {
    echo -e "${RED}[FAILURE]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1" >&2
}

# Execute command with logging
execute_with_log() {
    local cmd="$1"
    local description="${2:-$cmd}"
    log_command "$description"
    local output
    local exit_code
    
    output=$(eval "$cmd" 2>&1)
    exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        log_success "$description completed successfully"
        if [ -n "$output" ]; then
            echo "$output" | while IFS= read -r line; do
                log_info "  $line"
            done
        fi
    else
        log_failure "$description failed with exit code: $exit_code"
        if [ -n "$output" ]; then
            echo "$output" | while IFS= read -r line; do
                log_error "  $line"
            done
        fi
    fi
    
    return $exit_code
}

# Check if minikube is running
check_minikube() {
    log_step "Checking Minikube status and availability"
    
    if ! command -v minikube &> /dev/null; then
        log_error "minikube command not found. Please install minikube."
        log_error "Installation: https://minikube.sigs.k8s.io/docs/start/"
        exit 1
    fi
    
    log_info "Minikube command found: $(which minikube)"
    
    if minikube status &> /dev/null; then
        log_info "Minikube is already running"
        local status_output=$(minikube status 2>&1)
        log_info "Minikube status: $status_output"
        
        # Ensure ingress addon is enabled
        log_info "Checking ingress addon status..."
        if ! minikube addons list 2>/dev/null | grep -q "ingress.*enabled"; then
            log_warn "Ingress addon is not enabled. Enabling..."
            log_command "minikube addons enable ingress"
            if minikube addons enable ingress 2>&1; then
                log_info "Ingress addon enabled successfully"
            else
                log_warn "Failed to enable ingress addon (may already be enabled or error occurred)"
            fi
        else
            log_info "Ingress addon is already enabled"
        fi
        return 0
    else
        log_warn "Minikube is not running. Attempting to start..."
        log_command "minikube start"
        if minikube start 2>&1; then
            log_info "Minikube started successfully with default settings"
            return 0
        else
            local start_error=$?
            log_error "Failed to start Minikube with default settings (exit code: $start_error)"
            log_info "Attempting to start Minikube with specified resources (cpu=4, memory=7g)..."
            log_command "make setup cpu=4 memory=7g"
            if make setup cpu=4 memory=7g 2>&1; then
                log_info "Minikube setup completed successfully with specified resources"
                return 0
            else
                local setup_error=$?
                log_error "Failed to setup Minikube (exit code: $setup_error)"
                log_error "Please check Minikube installation and system resources"
                return 1
            fi
        fi
    fi
}

# Get current setupMethod from config.yaml
get_current_setup_method() {
    if [ -f "$CONFIG_FILE" ]; then
        local line=$(grep -E "^\s*setupMethod:" "$CONFIG_FILE" | head -1)
        # Extract value between quotes, handling both single and double quotes
        local method=$(echo "$line" | sed -n "s/.*setupMethod:[[:space:]]*['\"]\([^'\"]*\)['\"].*/\1/p")
        if [ -n "$method" ]; then
            log_info "Read setupMethod from config: '$method'"
            echo "$method"
        else
            log_warn "Could not parse setupMethod from config file. Line: $line"
            echo ""
        fi
    else
        log_warn "Config file not found: $CONFIG_FILE"
        echo ""
    fi
}

# Check if pods are running
pods_exist() {
    log_info "Checking if pods exist in namespace: $NAMESPACE"
    if kubectl get pods -n "$NAMESPACE" &> /dev/null; then
        local pod_count=$(kubectl get pods -n "$NAMESPACE" --no-headers 2>/dev/null | wc -l | tr -d ' ')
        log_info "Found $pod_count pod(s) in namespace $NAMESPACE"
        if [ "$pod_count" -gt 0 ]; then
            log_info "Pods exist: $(kubectl get pods -n "$NAMESPACE" --no-headers 2>/dev/null | awk '{print $1}' | tr '\n' ' ')"
            return 0
        fi
    else
        log_warn "Failed to query pods in namespace $NAMESPACE (namespace may not exist)"
    fi
    log_info "No pods found in namespace $NAMESPACE"
    return 1
}

# Check if minikube is running
is_minikube_running() {
    minikube status &> /dev/null
}

# Check pods and setupMethod, deploy if needed
check_and_deploy() {
    local target_setup_method=$1
    
    log_step "Checking deployment status for setup method: $target_setup_method"
    
    if pods_exist; then
        log_info "Pods exist. Checking current setupMethod in config.yaml..."
        local current_setup_method=$(get_current_setup_method)
        
        if [ -z "$current_setup_method" ]; then
            log_warn "Could not read setupMethod from config.yaml. Proceeding with deployment..."
        elif [ "$current_setup_method" != "$target_setup_method" ]; then
            log_warn "SetupMethod mismatch detected!"
            log_warn "  Current: '$current_setup_method'"
            log_warn "  Required: '$target_setup_method'"
            log_info "Running teardown before redeploying with correct setupMethod..."
            log_command "make teardown"
            if make teardown 2>&1; then
                log_info "Teardown completed successfully"
            else
                local teardown_error=$?
                log_warn "Teardown completed with warnings (exit code: $teardown_error). Continuing..."
            fi
            log_info "Waiting 5 seconds for resources to clean up..."
            sleep 5
        else
            log_info "SetupMethod matches target: '$target_setup_method'"
            log_info "Checking if pods are ready..."
            # Check if pods are ready
            local ready_pods=$(kubectl get pods -n "$NAMESPACE" -o jsonpath='{.items[*].status.conditions[?(@.type=="Ready")].status}' 2>/dev/null | grep -c "True" || echo "0")
            local total_pods=$(kubectl get pods -n "$NAMESPACE" --no-headers 2>/dev/null | wc -l | tr -d ' ')
            log_info "Pod status: $ready_pods ready out of $total_pods total"
            
            if [ "$ready_pods" -eq 0 ]; then
                log_warn "Pods exist but none are ready. Redeploying..."
                log_command "make teardown"
                if make teardown 2>&1; then
                    log_info "Teardown completed"
                else
                    log_warn "Teardown had issues but continuing..."
                fi
                log_info "Waiting 5 seconds..."
                sleep 5
            else
                log_info "Pods are running and ready. Skipping deployment."
                return 0
            fi
        fi
    else
        log_info "No pods found in namespace. Deployment needed."
    fi
    
    # Update config.yaml with target setup method
    log_info "Updating config.yaml with target setupMethod..."
    if ! update_setup_method "$target_setup_method"; then
        log_error "Failed to update config.yaml. Cannot proceed with deployment."
        return 1
    fi
    
    # Check if minikube is running to decide whether to run setup
    if is_minikube_running; then
        log_info "Minikube is already running. Skipping setup, running deployment only..."
        log_command "make deploy"
        if make deploy 2>&1; then
            log_info "Deployment completed successfully"
            return 0
        else
            local deploy_error=$?
            log_error "Deployment failed (exit code: $deploy_error)"
            log_error "Check helmfile logs for details"
            return 1
        fi
    else
        log_warn "Minikube is not running. Running full setup and deployment..."
        log_command "make setup cpu=4 memory=7g && make deploy"
        if make setup cpu=4 memory=7g 2>&1 && make deploy 2>&1; then
            log_info "Setup and deployment completed successfully"
            return 0
        else
            local setup_error=$?
            log_error "Setup/deployment failed (exit code: $setup_error)"
            log_error "Check minikube and helmfile logs for details"
            return 1
        fi
    fi
}

# Update setupMethod in config.yaml
update_setup_method() {
    local method=$1
    log_info "Updating config.yaml: setupMethod = '$method'"
    
    if [ ! -f "$CONFIG_FILE" ]; then
        log_error "Config file not found: $CONFIG_FILE"
        log_error "Expected path: $(pwd)/$CONFIG_FILE"
        return 1
    fi
    
    log_info "Config file found. Current content (setupMethod line):"
    grep -E "^\s*setupMethod:" "$CONFIG_FILE" | head -1 || log_warn "Could not find setupMethod line"
    
    # Use sed to update setupMethod
    log_command "sed -i update setupMethod in $CONFIG_FILE"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS requires different sed syntax
        if sed -i '' "s/setupMethod: '.*'/setupMethod: '$method'/" "$CONFIG_FILE" 2>&1; then
            log_info "Config file updated (macOS sed syntax)"
        else
            log_error "Failed to update config file with sed"
            return 1
        fi
    else
        if sed -i "s/setupMethod: '.*'/setupMethod: '$method'/" "$CONFIG_FILE" 2>&1; then
            log_info "Config file updated (Linux sed syntax)"
        else
            log_error "Failed to update config file with sed"
            return 1
        fi
    fi
    
    # Verify the change
    log_info "Verifying config update..."
    local line=$(grep -E "^\s*setupMethod:" "$CONFIG_FILE" | head -1)
    local updated=$(echo "$line" | sed -n "s/.*setupMethod:[[:space:]]*['\"]\([^'\"]*\)['\"].*/\1/p")
    if [ "$updated" == "$method" ]; then
        log_info "Config verified: setupMethod = '$updated'"
        return 0
    else
        log_error "Config update verification failed!"
        log_error "  Expected: '$method'"
        log_error "  Actual: '$updated'"
        log_error "  Raw line: '$line'"
        log_info "Config file content around setupMethod:"
        grep -A 2 -B 2 "setupMethod:" "$CONFIG_FILE" || true
        return 1
    fi
}

# Wait for setup-job to complete with retries
wait_for_setup_job() {
    log_step "Waiting for setup-job to complete in namespace: $NAMESPACE"
    
    local max_attempts=3
    local attempt=1
    local wait_interval=300  # 5 minutes
    
    while [ $attempt -le $max_attempts ]; do
        log_info "Attempt $attempt/$max_attempts: Checking setup-job status..."
        log_command "kubectl get job setup-job -n $NAMESPACE"
        
        # Check if setup-job exists
        if ! kubectl get job setup-job -n "$NAMESPACE" &> /dev/null; then
            log_warn "Setup-job not found in namespace $NAMESPACE"
            log_info "Waiting 30 seconds for setup-job to be created..."
            sleep 30
            continue
        fi
        
        log_info "Setup-job exists. Checking status..."
        local job_info=$(kubectl get job setup-job -n "$NAMESPACE" -o jsonpath='{.status}' 2>/dev/null || echo "{}")
        log_info "Job status: $job_info"
        
        # Check if setup-job is complete
        local status=$(kubectl get job setup-job -n "$NAMESPACE" -o jsonpath='{.status.conditions[?(@.type=="Complete")].status}' 2>/dev/null || echo "")
        log_info "Completion status: '$status'"
        
        if [ "$status" == "True" ]; then
            # Verify it didn't fail
            local failed=$(kubectl get job setup-job -n "$NAMESPACE" -o jsonpath='{.status.conditions[?(@.type=="Failed")].status}' 2>/dev/null || echo "")
            log_info "Failure status: '$failed'"
            
            if [ "$failed" == "True" ]; then
                log_error "Setup-job failed!"
                log_info "Retrieving setup-job logs..."
                log_command "kubectl logs -n $NAMESPACE -l job-name=setup-job --tail=50"
                kubectl logs -n "$NAMESPACE" -l job-name=setup-job --tail=50 2>&1 || log_warn "Could not retrieve logs"
                return 1
            fi
            log_info "Setup-job completed successfully!"
            return 0
        fi
        
        if [ $attempt -lt $max_attempts ]; then
            log_warn "Setup-job not complete yet (status: '$status')"
            log_info "Waiting ${wait_interval}s (5 minutes) before next check..."
            sleep $wait_interval
        fi
        
        attempt=$((attempt + 1))
    done
    
    log_error "Setup-job did not complete after $max_attempts attempts (total wait time: $((max_attempts * wait_interval / 60)) minutes)"
    log_info "Retrieving final setup-job logs..."
    log_command "kubectl logs -n $NAMESPACE -l job-name=setup-job --tail=50"
    kubectl logs -n "$NAMESPACE" -l job-name=setup-job --tail=50 2>&1 || log_warn "Could not retrieve logs"
    return 1
}

# Run Playwright tests
run_tests() {
    local setup_method=$1
    log_step "Running Playwright tests for setup method: $setup_method"
    
    local e2e_path="$PROJECT_ROOT/$E2E_DIR"
    log_info "Changing directory to: $e2e_path"
    cd "$e2e_path" || {
        log_error "Failed to change directory to $e2e_path"
        return 1
    }
    
    # Set SETUP_METHOD environment variable
    export SETUP_METHOD="$setup_method"
    log_info "Set environment variable: SETUP_METHOD=$setup_method"
    
    # Check if npm is available
    if ! command -v npm &> /dev/null; then
        log_error "npm command not found. Please install Node.js and npm."
        cd "$PROJECT_ROOT"
        return 1
    fi
    
    # Check if package.json exists
    if [ ! -f "package.json" ]; then
        log_error "package.json not found in $e2e_path"
        log_error "Please run 'npm install' in the e2e directory first"
        cd "$PROJECT_ROOT"
        return 1
    fi
    
    log_info "Running Playwright tests..."
    log_command "npm run test:e2e (SETUP_METHOD=$setup_method)"
    
    if npm run test:e2e 2>&1; then
        local exit_code=$?
        log_info "Tests completed successfully for $setup_method (exit code: $exit_code)"
        cd "$PROJECT_ROOT"
        return 0
    else
        local exit_code=$?
        log_warn "Tests failed for $setup_method (exit code: $exit_code)"
        log_warn "Check test output above for details"
        cd "$PROJECT_ROOT"
        return $exit_code
    fi
}

# Save test report
save_report() {
    local setup_method=$1
    local source_report="$PROJECT_ROOT/$E2E_DIR/playwright-report/index.html"
    local target_report="$PROJECT_ROOT/$REPORTS_DIR/${setup_method}-report.html"
    
    log_info "Saving test report for $setup_method..."
    log_info "  Source: $source_report"
    log_info "  Target: $target_report"
    
    # Create reports directory if it doesn't exist
    log_command "mkdir -p $PROJECT_ROOT/$REPORTS_DIR"
    if mkdir -p "$PROJECT_ROOT/$REPORTS_DIR" 2>&1; then
        log_info "Reports directory created/verified: $PROJECT_ROOT/$REPORTS_DIR"
    else
        log_error "Failed to create reports directory"
        return 1
    fi
    
    if [ -f "$source_report" ]; then
        log_command "cp $source_report $target_report"
        if cp "$source_report" "$target_report" 2>&1; then
            local file_size=$(ls -lh "$target_report" 2>/dev/null | awk '{print $5}' || echo "unknown")
            log_info "Report saved successfully: $target_report (size: $file_size)"
            set_report_path "$setup_method" "$target_report"
            return 0
        else
            log_error "Failed to copy report file"
            return 1
        fi
    else
        log_warn "Source report not found: $source_report"
        log_warn "Tests may not have generated a report, or report location changed"
        return 1
    fi
}

# Teardown deployment
teardown_deployment() {
    log_step "Tearing down deployment in namespace: $NAMESPACE"
    
    log_command "make teardown"
    if make teardown 2>&1; then
        log_info "Teardown command completed successfully"
        
        # Wait for pods to terminate
        log_info "Waiting for pods to terminate (timeout: 60 seconds)..."
        local timeout=60
        local elapsed=0
        while pods_exist && [ $elapsed -lt $timeout ]; do
            log_info "Pods still exist, waiting... (elapsed: ${elapsed}s)"
            sleep 5
            elapsed=$((elapsed + 5))
        done
        
        if pods_exist; then
            log_warn "Some pods still exist after teardown timeout ($timeout seconds)"
            log_info "Remaining pods:"
            kubectl get pods -n "$NAMESPACE" 2>&1 || log_warn "Could not list pods"
        else
            log_info "All pods terminated successfully"
        fi
        
        return 0
    else
        local teardown_error=$?
        log_error "Teardown failed (exit code: $teardown_error)"
        log_error "Check teardown script output above for details"
        return 1
    fi
}

# Main execution
main() {
    log_step "=========================================="
    log_step "Automated E2E Test Runner"
    log_step "=========================================="
    log_info "Project root: $PROJECT_ROOT"
    log_info "Script directory: $SCRIPT_DIR"
    log_info "Target namespace: $NAMESPACE"
    log_info "Setup methods to test: ${SETUP_METHODS[*]}"
    log_info "Config file: $CONFIG_FILE"
    log_info "Reports directory: $REPORTS_DIR"
    log_step "=========================================="
    
    # Check minikube
    log_step "Phase 1: Minikube Setup"
    if ! check_minikube; then
        log_failure "Failed to start Minikube. Cannot proceed."
        log_error "Please check:"
        log_error "  1. Minikube is installed: minikube version"
        log_error "  2. Docker is running: docker ps"
        log_error "  3. System has enough resources (CPU: 4, Memory: 7GB)"
        exit 1
    fi
    log_success "Minikube is ready"
    
    # Process each setup method
    local method_index=1
    local total_methods=${#SETUP_METHODS[@]}
    
    for setup_method in "${SETUP_METHODS[@]}"; do
        log_step "=========================================="
        log_step "Processing setup method $method_index/$total_methods: $setup_method"
        log_step "=========================================="
        
        # Phase 2: Deployment
        log_step "Phase 2.$method_index: Deployment for $setup_method"
        if ! check_and_deploy "$setup_method"; then
            log_failure "Deployment failed for $setup_method"
            log_error "Skipping to next setup method..."
            set_result "$setup_method" "DEPLOY_FAILED"
            method_index=$((method_index + 1))
            continue
        fi
        log_success "Deployment completed for $setup_method"
        
        # Phase 3: Wait for setup-job
        log_step "Phase 3.$method_index: Waiting for setup-job ($setup_method)"
        if ! wait_for_setup_job; then
            log_failure "Setup-job failed for $setup_method"
            log_error "Skipping tests and cleaning up..."
            set_result "$setup_method" "SETUP_JOB_FAILED"
            teardown_deployment || true
            method_index=$((method_index + 1))
            continue
        fi
        log_success "Setup-job completed for $setup_method"
        
        # Phase 4: Run tests
        log_step "Phase 4.$method_index: Running tests ($setup_method)"
        if run_tests "$setup_method"; then
            log_success "Tests passed for $setup_method"
            set_result "$setup_method" "PASSED"
        else
            log_failure "Tests failed for $setup_method"
            set_result "$setup_method" "FAILED"
        fi
        
        # Phase 5: Save report
        log_step "Phase 5.$method_index: Saving report ($setup_method)"
        if save_report "$setup_method"; then
            log_success "Report saved for $setup_method"
        else
            log_warn "Failed to save report for $setup_method (tests may have failed)"
        fi
        
        # Phase 6: Teardown (except for last method)
        if [ "$setup_method" != "${SETUP_METHODS[-1]}" ]; then
            log_step "Phase 6.$method_index: Teardown ($setup_method)"
            teardown_deployment || true
            log_info "Waiting 5 seconds before next setup method..."
            sleep 5
        fi
        
        method_index=$((method_index + 1))
    done
    
    # Final teardown
    log_info "Final teardown..."
    teardown_deployment || true
    
    # Print summary
    log_info "=========================================="
    log_info "Test Summary"
    log_info "=========================================="
    
    local all_passed=true
    for setup_method in "${SETUP_METHODS[@]}"; do
        local result=$(get_result "$setup_method")
        local report_path=$(get_report_path "$setup_method")
        
        case "$result" in
            "PASSED")
                log_info "$setup_method: ${GREEN}PASSED${NC}"
                ;;
            "FAILED")
                log_warn "$setup_method: ${RED}FAILED${NC}"
                all_passed=false
                ;;
            "DEPLOY_FAILED")
                log_error "$setup_method: ${RED}DEPLOY_FAILED${NC}"
                all_passed=false
                ;;
            "SETUP_JOB_FAILED")
                log_error "$setup_method: ${RED}SETUP_JOB_FAILED${NC}"
                all_passed=false
                ;;
            *)
                log_warn "$setup_method: ${YELLOW}UNKNOWN${NC}"
                all_passed=false
                ;;
        esac
        
        if [ -n "$report_path" ]; then
            log_info "  Report: $report_path"
        fi
    done
    
    log_info "=========================================="
    log_info "All reports saved in: $PROJECT_ROOT/$REPORTS_DIR"
    log_info "=========================================="
    
    if [ "$all_passed" = true ]; then
        log_info "All tests passed!"
        exit 0
    else
        log_error "Some tests failed. Check reports for details."
        exit 1
    fi
}

# Run main function
main "$@"

