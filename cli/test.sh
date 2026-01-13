#!/bin/bash
# Integration test for local-pr-cli

set -e  # Exit on error

CLI="node dist/index.js"
TEST_FILE="test-file.ts"
REVIEW_DIR=".review"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Cleanup
cleanup() {
  rm -rf "$REVIEW_DIR" "$TEST_FILE" "$TEST_FILE"2 2>/dev/null || true
}

# Ensure cleanup on exit
trap cleanup EXIT

echo "🧪 Running local-pr-cli tests..."

# Setup
setup() {
  cleanup
  cat > "$TEST_FILE" <<EOF
function test() {
  return 42;
}
EOF
}

# Test helpers
assert_equals() {
  local expected="$1"
  local actual="$2"
  local message="$3"

  if [ "$expected" = "$actual" ]; then
    echo -e "${GREEN}✓${NC} $message"
  else
    echo -e "${RED}✗${NC} $message"
    echo "  Expected: $expected"
    echo "  Actual: $actual"
    exit 1
  fi
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local message="$3"

  if echo "$haystack" | grep -q "$needle"; then
    echo -e "${GREEN}✓${NC} $message"
  else
    echo -e "${RED}✗${NC} $message"
    echo "  Expected to contain: $needle"
    echo "  Actual: $haystack"
    exit 1
  fi
}

# Test 1: Add comment
test_add() {
  echo ""
  echo "📝 Test: Add comment"

  output=$($CLI add --file "$TEST_FILE" --line 1 --message "Test comment" --severity warning --title "Test")
  assert_contains "$output" "Created comment #1" "Should create comment #1"

  # Verify file exists
  [ -f "$REVIEW_DIR/files/test-file.ts.jsonl.gz" ]
  assert_equals "0" "$?" "Review file should exist"
}

# Test 2: List comments
test_list() {
  echo ""
  echo "📋 Test: List comments"

  output=$($CLI list)
  assert_contains "$output" "test-file.ts" "Should show filename"
  assert_contains "$output" "#1" "Should show comment ID"
  assert_contains "$output" "Test comment" "Should show message"
  assert_contains "$output" "🟡" "Should show warning icon"
}

# Test 3: List with JSON format
test_list_json() {
  echo ""
  echo "🔍 Test: List with JSON format"

  output=$($CLI list --file "$TEST_FILE" --format json)
  assert_contains "$output" '"id": "1"' "JSON should contain id"
  assert_contains "$output" '"message": "Test comment"' "JSON should contain message"
  assert_contains "$output" '"severity": "warning"' "JSON should contain severity"
}

# Test 4: Add second comment
test_add_second() {
  echo ""
  echo "📝 Test: Add second comment"

  output=$($CLI add --file "$TEST_FILE" --line 2 --message "Second comment" --severity error)
  assert_contains "$output" "Created comment #2" "Should create comment #2"

  count=$(gunzip -c "$REVIEW_DIR/files/test-file.ts.jsonl.gz" | grep -c "^{" || true)
  assert_equals "2" "$count" "Should have 2 comments"
}

# Test 5: Reply to comment
test_reply() {
  echo ""
  echo "💬 Test: Reply to comment"

  output=$($CLI reply --file "$TEST_FILE" --id 1 --message "Reply message")
  assert_contains "$output" "Added reply" "Should add reply"

  json=$($CLI list --file "$TEST_FILE" --format json)
  assert_contains "$json" '"message": "Reply message"' "JSON should contain reply"
}

# Test 6: Resolve comment
test_resolve() {
  echo ""
  echo "✅ Test: Resolve comment"

  output=$($CLI resolve --file "$TEST_FILE" --id 1)
  assert_contains "$output" "Resolved comment #1" "Should resolve comment"

  list_output=$($CLI list --file "$TEST_FILE")
  assert_contains "$list_output" "[RESOLVED]" "Should show resolved status"
}

# Test 7: List active only
test_list_active() {
  echo ""
  echo "🔎 Test: List active comments only"

  output=$($CLI list --active true)
  assert_contains "$output" "#2" "Should show active comment #2"

  # Count lines - should only have one comment section (the active one)
  count=$(echo "$output" | grep -c "^  #" || true)
  assert_equals "1" "$count" "Should show only 1 active comment"
}

# Test 8: Delete comment
test_delete() {
  echo ""
  echo "🗑️  Test: Delete comment"

  output=$($CLI delete --file "$TEST_FILE" --id 2)
  assert_contains "$output" "Deleted comment #2" "Should delete comment"

  count=$(gunzip -c "$REVIEW_DIR/files/test-file.ts.jsonl.gz" | grep -c "^{" || true)
  assert_equals "1" "$count" "Should have 1 comment after deletion"
}

# Test 9: Error handling - missing file
test_error_missing_file() {
  echo ""
  echo "❌ Test: Error handling - missing file"

  if $CLI add --line 1 --message "Test" 2>&1 | grep -q "Usage:"; then
    echo -e "${GREEN}✓${NC} Should show usage message for missing file"
  else
    echo -e "${RED}✗${NC} Should show usage message for missing file"
    exit 1
  fi
}

# Test 10: Error handling - invalid comment ID
test_error_invalid_id() {
  echo ""
  echo "❌ Test: Error handling - invalid comment ID"

  if $CLI resolve --file "$TEST_FILE" --id 999 2>&1 | grep -q "not found"; then
    echo -e "${GREEN}✓${NC} Should show error for invalid ID"
  else
    echo -e "${RED}✗${NC} Should show error for invalid ID"
    exit 1
  fi
}

# Test 11: Multi-line comments with --end-line (independent)
test_multiline_comment() {
  echo ""
  echo "📄 Test: Multi-line comment with --end-line"

  # Independent setup
  cleanup
  setup

  output=$($CLI add --file "$TEST_FILE" --line 1 --end-line 3 --message "Multi-line issue" --severity warning)
  assert_contains "$output" "Created comment" "Should create multi-line comment"

  json=$($CLI list --file "$TEST_FILE" --format json)
  assert_contains "$json" '"endLine": 3' "JSON should contain endLine"

  list_output=$($CLI list --file "$TEST_FILE")
  assert_contains "$list_output" "L1-3" "Should show line range"
}

# Test 12: Reply with custom author (independent)
test_reply_custom_author() {
  echo ""
  echo "👤 Test: Reply with custom author"

  # Independent setup
  cleanup
  setup

  # Setup: create a comment first
  $CLI add --file "$TEST_FILE" --line 1 --message "Original" --severity info > /dev/null

  output=$($CLI reply --file "$TEST_FILE" --id 1 --message "User reply" --author user)
  assert_contains "$output" "Added reply" "Should add reply with custom author"

  json=$($CLI list --file "$TEST_FILE" --format json)
  assert_contains "$json" '"author": "user"' "JSON should contain custom author"
}

# Test 13: Outdated comments (independent)
test_outdated_handling() {
  echo ""
  echo "⚠️  Test: Outdated comment handling"

  # Independent setup
  cleanup
  setup

  # Note: Actual outdated detection happens in VSCode extension
  # Here we test manual marking by modifying the file directly

  $CLI add --file "$TEST_FILE" --line 1 --message "Will become outdated" --severity info > /dev/null

  # Manually mark as outdated via JSON manipulation
  content=$(gunzip -c "$REVIEW_DIR/files/test-file.ts.jsonl.gz")
  updated=$(echo "$content" | sed 's/"message":"Will become outdated"/"message":"Will become outdated","outdated":true/')
  echo "$updated" | gzip > "$REVIEW_DIR/files/test-file.ts.jsonl.gz"

  # List should show outdated marker
  list_output=$($CLI list --file "$TEST_FILE")
  assert_contains "$list_output" "[OUTDATED]" "Should show outdated marker"

  # Active filter should exclude outdated
  active_output=$($CLI list --file "$TEST_FILE" --active true)
  count=$(echo "$active_output" | grep -c "^  #" || true)
  assert_equals "0" "$count" "Active list should not show outdated comments"
}

# Test 14: Empty comment list (independent)
test_empty_list() {
  echo ""
  echo "📭 Test: Empty comment list"

  cleanup
  setup

  output=$($CLI list)
  # Empty output is expected
  assert_equals "0" "$?" "Should exit successfully with empty list"
}

# Test 15: Special characters in file path (independent)
test_special_chars_path() {
  echo ""
  echo "🔤 Test: Special characters in file path"

  cleanup
  TEST_FILE2="path with spaces.ts"
  echo "const x = 1;" > "$TEST_FILE2"

  output=$($CLI add --file "$TEST_FILE2" --line 1 --message "Test" --severity info)
  assert_contains "$output" "Created comment" "Should handle path with spaces"

  list_output=$($CLI list --file "$TEST_FILE2")
  assert_contains "$list_output" "path with spaces.ts" "Should show filename with spaces"

  rm -f "$TEST_FILE2"
  cleanup
}

# Test 16: Very long message (independent)
test_long_message() {
  echo ""
  echo "📏 Test: Very long message"

  cleanup
  setup

  long_msg=$(printf 'x%.0s' {1..1000})
  output=$($CLI add --file "$TEST_FILE" --line 1 --message "$long_msg" --severity info)
  assert_contains "$output" "Created comment" "Should handle long message"

  json=$($CLI list --file "$TEST_FILE" --format json)
  assert_contains "$json" "xxxxxxxxxxxx" "JSON should contain long message"
}

# Test 17: Invalid line number (independent)
test_invalid_line_number() {
  echo ""
  echo "🔢 Test: Invalid line number"

  cleanup
  setup

  # Line 0 - CLI doesn't validate, but getLineContent returns empty
  output=$($CLI add --file "$TEST_FILE" --line 0 --message "Line 0" --severity info)
  assert_contains "$output" "Created comment" "Should create comment with line 0"

  json=$($CLI list --file "$TEST_FILE" --format json)
  assert_contains "$json" '"line": 0' "JSON should contain line 0"
  assert_contains "$json" '"line_content": ""' "Line content should be empty"
}

# Test 18: Non-existent file (independent)
test_nonexistent_file() {
  echo ""
  echo "❓ Test: Add comment to non-existent file"

  cleanup

  output=$($CLI add --file "nonexistent.ts" --line 1 --message "Test" --severity info)
  assert_contains "$output" "Created comment" "Should create comment even if file doesn't exist"

  json=$($CLI list --file "nonexistent.ts" --format json)
  assert_contains "$json" '"line_content": ""' "Line content should be empty for non-existent file"
}

# Test 19: Double resolve (independent)
test_double_resolve() {
  echo ""
  echo "♻️  Test: Resolve comment twice"

  cleanup
  setup

  $CLI add --file "$TEST_FILE" --line 1 --message "Test" --severity info > /dev/null
  $CLI resolve --file "$TEST_FILE" --id 1 > /dev/null

  # Resolve again
  output=$($CLI resolve --file "$TEST_FILE" --id 1)
  assert_contains "$output" "Resolved comment" "Should allow resolving already resolved comment"
}

# Test 20: Operate on deleted comment (independent)
test_operate_on_deleted() {
  echo ""
  echo "🗑️  Test: Operate on deleted comment"

  cleanup
  setup

  $CLI add --file "$TEST_FILE" --line 1 --message "Test" --severity info > /dev/null
  $CLI delete --file "$TEST_FILE" --id 1 > /dev/null

  # Try to resolve deleted comment
  if $CLI resolve --file "$TEST_FILE" --id 1 2>&1 | grep -q "not found"; then
    echo -e "${GREEN}✓${NC} Should show error for deleted comment"
  else
    echo -e "${RED}✗${NC} Should show error for deleted comment"
    exit 1
  fi
}

# Test 21: Multiple files (independent)
test_multiple_files() {
  echo ""
  echo "📁 Test: Multiple files"

  cleanup
  TEST_FILE2="test-file2.ts"
  echo "const y = 2;" > "$TEST_FILE2"
  echo "const x = 1;" > "$TEST_FILE"

  $CLI add --file "$TEST_FILE" --line 1 --message "Comment on file1" --severity info > /dev/null
  $CLI add --file "$TEST_FILE2" --line 1 --message "Comment on file2" --severity warning > /dev/null

  output=$($CLI list)
  assert_contains "$output" "test-file.ts" "Should show first file"
  assert_contains "$output" "test-file2.ts" "Should show second file"

  rm -f "$TEST_FILE2"
}

# Test 22: All severity levels (independent)
test_all_severities() {
  echo ""
  echo "🚦 Test: All severity levels"

  cleanup
  cat > "$TEST_FILE" <<EOF
line 1
line 2
line 3
EOF

  $CLI add --file "$TEST_FILE" --line 1 --message "Info" --severity info > /dev/null
  $CLI add --file "$TEST_FILE" --line 2 --message "Warning" --severity warning > /dev/null
  $CLI add --file "$TEST_FILE" --line 3 --message "Error" --severity error > /dev/null

  output=$($CLI list)
  assert_contains "$output" "🟢" "Should show info icon"
  assert_contains "$output" "🟡" "Should show warning icon"
  assert_contains "$output" "🔴" "Should show error icon"
}

# Test 23: Invalid severity value (independent)
test_invalid_severity() {
  echo ""
  echo "❌ Test: Invalid severity value"

  cleanup
  setup

  if $CLI add --file "$TEST_FILE" --line 1 --message "Test" --severity invalid 2>&1 | grep -q "Invalid severity"; then
    echo -e "${GREEN}✓${NC} Should show error for invalid severity"
  else
    echo -e "${RED}✗${NC} Should show error for invalid severity"
    exit 1
  fi
}

# Run tests
setup

test_add
test_list
test_list_json
test_add_second
test_reply
test_resolve
test_list_active
test_delete
test_error_missing_file
test_error_invalid_id
test_multiline_comment
test_reply_custom_author
test_outdated_handling
test_empty_list
test_special_chars_path
test_long_message
test_invalid_line_number
test_nonexistent_file
test_double_resolve
test_operate_on_deleted
test_multiple_files
test_all_severities
test_invalid_severity

echo ""
echo -e "${GREEN}✨ All tests passed!${NC}"
