import? '~/justfile'

# HSC Math Prep — local task runner

# List recent GitHub Actions runs
list-runs:
    gh run list --repo ross-jill-ws/$(basename $(pwd))

pi-hsc *args:
    cd "{{invocation_directory()}}" && n exec 22.17.1 pi \
    --skill /Users/rossz/workspace/ai-tools/pi/rossz-extensions/general-extensions/skills \
    --skill "{{invocation_directory()}}"/.claude/skills \
    --prompt-template "{{invocation_directory()}}"/.claude/commands  \
    {{args}}
