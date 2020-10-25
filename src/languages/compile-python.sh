#!/bin/bash

# Compile a python source file with the name "main.py" to bytecode cache
# The source file will be copied to the destination binary directory
# And `python -m py_compile` is used to compile
#
# $1: The `python` program used to do the compilation
# $2: The absolute path of python source file directory
# $3: The absolute path of destination binary directory
#
# stderr / stderr: The stdout / stderr of `python -m py_compile`

SOURCE_FILENAME="main.py"

# Change working directory to destination binary directory
cd "$3"
# Copy the source file to working directory
cp "$2/$SOURCE_FILENAME" .

PYTHON="$1"

$PYTHON -m py_compile "$SOURCE_FILENAME"
