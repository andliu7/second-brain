# Generate queue

The **Generate visuals** button works through every unchecked `- [ ]` line under
*Queue*, top to bottom, one image at a time. It ticks each line and appends the file
it saved to `C:\Users\zeusa\generations\`. An empty queue is a no-op, not an error.

**Images only.** A video needs a quoted cost and an explicit go, and a headless run
has nobody to say go. Put video requests in a chat session with `/generate` instead.

## How to write a line

Project first (it becomes the filename prefix), then what you want, then any size.
A logo, face or product shot needs the real file in `generations\refs\` named on the
line; the skill refuses to describe one in words.

Example, not queued:

    blueberry: hero thumbnail, flask on a dark desk, 16:9, palette from DESIGN-TOKENS.md
    cmsc434: persona card background, soft paper texture, 4:3

## Queue

