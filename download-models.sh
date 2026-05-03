#!/usr/bin/env bash
# Download vosk speech recognition models for hail-mary.
# alphacephei.com distributes .zip; we repack as .tar.gz for vosk-browser.
set -e

DEST="client/public/cdn/sillyz.computer/models"
TMP=$(mktemp -d)
trap "rm -rf $TMP" EXIT

models=(
  "vosk-model-small-en-us-0.15"
  "vosk-model-small-en-in-0.4"
  "vosk-model-small-de-0.15"
  "vosk-model-small-fr-pguyot-0.3"
  "vosk-model-small-es-0.42"
  "vosk-model-small-pt-0.3"
  "vosk-model-small-ru-0.22"
  "vosk-model-small-it-0.22"
  "vosk-model-small-nl-0.22"
  "vosk-model-small-tr-0.3"
  "vosk-model-small-fa-0.42"
  "vosk-model-small-cn-0.22"
  "vosk-model-small-ca-0.4"
)

for model in "${models[@]}"; do
  dest="$DEST/${model}.tar.gz"
  if [ -f "$dest" ]; then
    echo "skip: $model (already exists)"
    continue
  fi
  echo "downloading $model..."
  curl -L -o "$TMP/${model}.zip" "https://alphacephei.com/vosk/models/${model}.zip"
  (cd "$TMP" && unzip -q "${model}.zip")
  tar -czf "$dest" -C "$TMP" "$model"
  echo "ok: $dest"
done

echo "done."
