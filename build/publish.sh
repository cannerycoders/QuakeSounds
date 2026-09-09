#!/bin/sh -f
echo "NB: this script publishes QuakeSounds to a live website!"
echo "    Run it manually!  ./build/publish.sh"

DIR="QuakeSounds"
SRC="_dist/"
rsync -avz --delete ${SRC} "${PUBAPPS}/${DIR}/"
