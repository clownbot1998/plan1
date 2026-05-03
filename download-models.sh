#!/usr/bin/env bash
# Download vosk speech recognition models for hail-mary.
# alphacephei.com distributes .zip; vosk-browser extracts zip natively.
set -e

DEST="client/public/cdn/sillyz.computer/models"

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
  dest="$DEST/${model}.zip"
  if [ -f "$dest" ]; then
    echo "skip: $model (already exists)"
    continue
  fi
  echo "downloading $model..."
  curl -L -o "$dest" "https://alphacephei.com/vosk/models/${model}.zip"
  echo "ok: $dest"
done

echo "done."
