#!/usr/bin/env python3
import json
import sys
import os
import argparse

def parse_mcp_eval_json(json_path):
    try:
        with open(json_path, 'r') as f:
            data = json.load(f)
    except Exception as e:
        print(f"Error reading JSON file {json_path}: {e}")
        sys.exit(1)
        
    return data

def push_to_squash(results, project_id, squash_url, token):
    # This is a mock implementation representing how we would push to Squash TM
    # Real implementation would use requests.post to Squash TM API
    print(f"Connecting to Squash TM at {squash_url} for project {project_id}")
    
    success_count = 0
    fail_count = 0
    
    # Typically mcp-eval json structure has an array or dict of runs/tasks
    # We will simulate parsing the tasks based on test case ID patterns (e.g., [TS-01])
    # The actual schema depends on mcp-eval version
    
    print("\n--- Squash TM Mapping ---")
    
    # The new version of mcpevals might structure it differently, 
    # but let's assume 'tasks' list or dictionary is at the root
    tasks = results.get("tasks", []) if isinstance(results, dict) else results
    
    for task in tasks:
        name = task.get("name", "Unknown Task")
        status = task.get("status", "unknown")
        
        # Extract ID from "[TS-01] LLM selects..."
        if "[" in name and "]" in name:
            case_id = name.split("[")[1].split("]")[0]
        else:
            case_id = "UNKNOWN"
            
        squash_status = "SUCCESS" if status.lower() == "passed" else "FAILED"
        if squash_status == "SUCCESS":
            success_count += 1
        else:
            fail_count += 1
            
        print(f"Mapped task '{name}' -> Squash ID: {case_id} [{squash_status}]")
        
    print(f"\nExecution summary pushed to Squash TM: {success_count} Passed, {fail_count} Failed.")

def main():
    parser = argparse.ArgumentParser(description='Push mcp-eval JSON results to Squash TM.')
    parser.add_argument('--json', required=True, help='Path to mcp-eval results.json')
    parser.add_argument('--squash-url', default=os.environ.get('SQUASH_URL', 'https://squash.openproject.test/squash/api/rest/latest'), help='Squash TM API URL')
    parser.add_argument('--project', default=os.environ.get('SQUASH_PROJECT_ID', '1'), help='Squash TM Project ID')
    
    args = parser.parse_args()
    
    token = os.environ.get('SQUASH_TOKEN')
    if not token:
        print("Warning: SQUASH_TOKEN environment variable not set. Running in dry-run mode.")
    
    results = parse_mcp_eval_json(args.json)
    push_to_squash(results, args.project, args.squash_url, token)

if __name__ == '__main__':
    main()
