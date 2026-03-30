#!/bin/bash

# VERSION is read from VERSION.txt so we have a single source of truth for releases
VERSION=$(cat VERSION.txt | tr -d '[:space:]')

# Ideally this should be auto-run (fiddly with git hooks)

# Why have a version.json?
# Allows devs to check what version of code is running on a particular server
# Machine readable

# The current git commit hash
# COMMIT_HASH=$1 Use this if passed in by the CI-CD pipeline
COMMIT_HASH=$(git rev-parse HEAD) # use this if run by a git hook

# Get the current date in ISO 8601 format
CURRENT_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

VERSION_INFO_FILE=version.json

# Create or update the version-info.json file
echo "{
  \"VERSION\": \"$VERSION\",
  \"GIT_COMMIT\": \"$COMMIT_HASH\",
  \"DATE\": \"$CURRENT_DATE\"
}" > $VERSION_INFO_FILE

# Copy out to dirs
FILES=(../aiqa-client-go/version.json ../aiqa-client-js/version.json server/src/version.json webapp/public/.well-known/version.json website/webroot/.well-known/version.json)

for FILE in ${FILES[@]}; do
    DIR=$(dirname "$FILE")
    if [ ! -d "$DIR" ]; then
        mkdir -p "$DIR"
    fi
    echo "Copying to $FILE"
    cp $VERSION_INFO_FILE $FILE
done

# Update Python constants.py VERSION
PYTHON_CONSTANTS_FILE="../aiqa-client-python/aiqa/constants.py"
if [ -f "$PYTHON_CONSTANTS_FILE" ]; then
    echo "Updating $PYTHON_CONSTANTS_FILE VERSION"
    # Use sed to update VERSION line, preserving the rest of the file
    # macOS (BSD) sed requires an extension argument, Linux (GNU) sed doesn't
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/^VERSION = \".*\"/VERSION = \"$VERSION\"/" "$PYTHON_CONSTANTS_FILE"
    else
        sed -i "s/^VERSION = \".*\"/VERSION = \"$VERSION\"/" "$PYTHON_CONSTANTS_FILE"
    fi
    echo "Updated VERSION to $VERSION in $PYTHON_CONSTANTS_FILE"
else
    echo "Warning: $PYTHON_CONSTANTS_FILE not found, skipping VERSION update"
fi
# Update Python pyproject.toml
PYTHON_PYPROJECT_FILE="../aiqa-client-python/pyproject.toml"
if [ -f "$PYTHON_PYPROJECT_FILE" ]; then
    echo "Updating $PYTHON_PYPROJECT_FILE version"
    # macOS (BSD) sed requires an extension argument, Linux (GNU) sed doesn't
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/^version = \".*\"/version = \"$VERSION\"/" "$PYTHON_PYPROJECT_FILE"
    else
        sed -i "s/^version = \".*\"/version = \"$VERSION\"/" "$PYTHON_PYPROJECT_FILE"
    fi
    echo "Updated version to $VERSION in $PYTHON_PYPROJECT_FILE"
else
    echo "Warning: $PYTHON_PYPROJECT_FILE not found, skipping version update"
fi

# Update Go constants.go VERSION
GO_CONSTANTS_FILE="../aiqa-client-go/constants.go"
if [ -f "$GO_CONSTANTS_FILE" ]; then
    echo "Updating $GO_CONSTANTS_FILE VERSION"
    # Use sed to update Version line, preserving the rest of the file
    # macOS (BSD) sed requires an extension argument, Linux (GNU) sed doesn't
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/^	Version = \".*\"/	Version = \"$VERSION\"/" "$GO_CONSTANTS_FILE"
    else
        sed -i "s/^	Version = \".*\"/	Version = \"$VERSION\"/" "$GO_CONSTANTS_FILE"
    fi
    echo "Updated VERSION to $VERSION in $GO_CONSTANTS_FILE"
else
    echo "Warning: $GO_CONSTANTS_FILE not found, skipping VERSION update"
fi

# MCP server: package.json and runtime SERVER_VERSION (src; rebuild dist separately)
MCP_PACKAGE_JSON="mcp/package.json"
if [ -f "$MCP_PACKAGE_JSON" ]; then
    echo "Updating $MCP_PACKAGE_JSON version"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/^  \"version\": \".*\"/  \"version\": \"$VERSION\"/" "$MCP_PACKAGE_JSON"
    else
        sed -i "s/^  \"version\": \".*\"/  \"version\": \"$VERSION\"/" "$MCP_PACKAGE_JSON"
    fi
    echo "Updated version to $VERSION in $MCP_PACKAGE_JSON"
else
    echo "Warning: $MCP_PACKAGE_JSON not found, skipping version update"
fi
MCP_INDEX_TS="mcp/src/index.ts"
if [ -f "$MCP_INDEX_TS" ]; then
    echo "Updating $MCP_INDEX_TS SERVER_VERSION"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/^const SERVER_VERSION = '.*';/const SERVER_VERSION = '$VERSION';/" "$MCP_INDEX_TS"
    else
        sed -i "s/^const SERVER_VERSION = '.*';/const SERVER_VERSION = '$VERSION';/" "$MCP_INDEX_TS"
    fi
    echo "Updated SERVER_VERSION to $VERSION in $MCP_INDEX_TS"
else
    echo "Warning: $MCP_INDEX_TS not found, skipping SERVER_VERSION update"
fi

# Report worker (server-python): FastAPI OpenAPI /docs version string
SERVER_PYTHON_APP="server-python/aiqa_report_worker/app.py"
if [ -f "$SERVER_PYTHON_APP" ]; then
    echo "Updating $SERVER_PYTHON_APP FastAPI version"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s|app = FastAPI(title=\"AIQA Report Worker\", version=\".*\")|app = FastAPI(title=\"AIQA Report Worker\", version=\"$VERSION\")|" "$SERVER_PYTHON_APP"
    else
        sed -i "s|app = FastAPI(title=\"AIQA Report Worker\", version=\".*\")|app = FastAPI(title=\"AIQA Report Worker\", version=\"$VERSION\")|" "$SERVER_PYTHON_APP"
    fi
    echo "Updated FastAPI version to $VERSION in $SERVER_PYTHON_APP"
else
    echo "Warning: $SERVER_PYTHON_APP not found, skipping FastAPI version update"
fi

echo "Version info:"
echo `cat $VERSION_INFO_FILE`

# # Stage the modified version.json files if we're in a git repository
# if git rev-parse --git-dir > /dev/null 2>&1; then
#     echo "Staging version.json files..."
#     git add version.json
#     git add ../aiqa-client-go/version.json ../aiqa-client-python/version.json ../aiqa-client-js/version.json
#     git add server/.well-known/version.json webapp/.well-known/version.json 2>/dev/null || true
#     echo "Version files staged successfully"
# fi
