#!/usr/bin/env bash
set -xe
cat matches | sed '/^\..*$/d'
