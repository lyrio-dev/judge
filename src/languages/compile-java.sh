#!/bin/bash

# Compile a Java program with any name
# If the public class name doesn't match, it will be extracted from the error message with a perl regexp:
#
# Main.java:3: error: class ClassName is public, should be declared in a file named ClassName.java
#
# $1: The absolute path of java source file
# $2: The absolute path of destination binary directory
#
# stderr: The stdout & stderr of javac
# stdout: The name of compiled class file with `.class` suffix removed

# Change working directory to destination binary directory
cd "$2"
# Copy the source file to working directory
cp "$1" .

# Get the original filename
ORIGINAL_FILENAME=$(basename "$1")

# Try compiling with the original filename
JAVAC_OPTIONS=""
JAVAC_OUTPUT=$(javac $JAVAC_OPTIONS "$ORIGINAL_FILENAME" 2>&1)
JAVAC_EXIT_CODE=$?

# If javac fails with the original filename
if [ "$JAVAC_EXIT_CODE" != 0 ]; then
    # Extract the public class name from javac's output
    PUBLIC_CLASS_NAME=$(perl -wnE 'say for /^\S[\S\s]+error: class (\S+) is public, should be declared in a file named (\S+)\.java$/g' <<< "$JAVAC_OUTPUT" | head -n 1)

    # If we got empty string, there must be other errors
    if [ -z "$PUBLIC_CLASS_NAME" ]; then
        # Print javac's output to stderr
        echo "$JAVAC_OUTPUT" >&2
        # Compilation fails
        exit $JAVAC_EXIT_CODE
    else
        EXPECTED_FILENAME="$PUBLIC_CLASS_NAME.java"

        # Rename the file with the expected filename and try compiling again
        mv "$ORIGINAL_FILENAME" "$EXPECTED_FILENAME"
        # No need to save the output javac since we don't need to parse it
        # But redirect stdout to stderr since we print its class name to stdout
        javac $JAVAC_OPTIONS "$EXPECTED_FILENAME" 1>&2

        # If javac fails
        JAVAC_EXIT_CODE=$?
        if [ "$JAVAC_EXIT_CODE" != 0 ]; then
            # Compilation fails
            exit $JAVAC_EXIT_CODE
        else
            # Remove source file
            rm "$EXPECTED_FILENAME"
            # Print class name to stdout (without newline)
            echo -n "$PUBLIC_CLASS_NAME"
            exit 0
        fi
    fi
else
    # Print javac's output to stderr
    echo "$JAVAC_OUTPUT" >&2
    # Remove ".java" suffix from the original filename as the class name (without newline)
    echo -n ${ORIGINAL_FILENAME/.java/}
    # Remove source file
    rm "$ORIGINAL_FILENAME"
    exit 0
fi
