#!/bin/bash

# Bump this version when you make a change to the codebase
VERSION="0.4.2"

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
FILES=(client-go/version.json client-js/version.json server/src/version.json webapp/.well-known/version.json website/webroot/.well-known/version.json)

for FILE in ${FILES[@]}; do
    DIR=$(dirname "$FILE")
    if [ ! -d "$DIR" ]; then
        mkdir -p "$DIR"
    fi
    echo "Copying to $FILE"
    cp $VERSION_INFO_FILE $FILE
done

# Update Python constants.py VERSION
PYTHON_CONSTANTS_FILE="client-python/aiqa/constants.py"
if [ -f "$PYTHON_CONSTANTS_FILE" ]; then
    echo "Updating $PYTHON_CONSTANTS_FILE VERSION"
    # Use sed to update VERSION line, preserving the rest of the file
    sed -i "s/^VERSION = \".*\"/VERSION = \"$VERSION\"/" "$PYTHON_CONSTANTS_FILE"
    echo "Updated VERSION to $VERSION in $PYTHON_CONSTANTS_FILE"
else
    echo "Warning: $PYTHON_CONSTANTS_FILE not found, skipping VERSION update"
fi
# Update Python pyproject.toml
PYTHON_PYPROJECT_FILE="client-python/pyproject.toml"
if [ -f "$PYTHON_PYPROJECT_FILE" ]; then
    echo "Updating $PYTHON_PYPROJECT_FILE version"
    sed -i "s/^version = \".*\"/version = \"$VERSION\"/" "$PYTHON_PYPROJECT_FILE"
    echo "Updated version to $VERSION in $PYTHON_PYPROJECT_FILE"
else
    echo "Warning: $PYTHON_PYPROJECT_FILE not found, skipping version update"
fi

echo "Version info:"
echo `cat $VERSION_INFO_FILE`

# # Stage the modified version.json files if we're in a git repository
# if git rev-parse --git-dir > /dev/null 2>&1; then
#     echo "Staging version.json files..."
#     git add version.json
#     git add client-go/version.json client-python/version.json client-js/version.json
#     git add server/.well-known/version.json webapp/.well-known/version.json 2>/dev/null || true
#     echo "Version files staged successfully"
# fi
