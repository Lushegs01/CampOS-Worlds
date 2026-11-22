# Production MCP tools

The project's MCP servers live in `.mcp.json` and are enabled for Claude Code in `.claude/settings.json`. They load
when a Claude Code session starts in this repository; a session that was already running needs a restart.

| Tool | Responsibility | Server | Where it works |
| --- | --- | --- | --- |
| Blender MCP | 3D environment, vehicles, characters and props | `uvx mcp-for-blender` | Only where Blender is open with its add-on connected (your own machine) |
| ElevenLabs MCP | Dialogue, police radio, sound effects and voice | claude.ai connector (not in `.mcp.json`) | Any session with the ElevenLabs connector connected |
| Playwright MCP | Real browser gameplay testing | `npx @playwright/mcp@latest --headless` | Anywhere with Node |
| Chrome DevTools MCP | Rendering, performance and debugging | `npx chrome-devtools-mcp@latest --headless --isolated` | Anywhere Chrome can start |
| three.js devtools | Live scene inspection and tweaks | `npx threejs-devtools-mcp` | Anywhere with Node |

## Blender

Blender MCP (renamed from `blender-mcp` to `mcp-for-blender`) talks to a running Blender over `localhost:9876`.

1. Install [uv](https://docs.astral.sh/uv/) so `uvx` is on your PATH.
2. Install the MCP for Blender add-on in Blender (see https://github.com/ahujasid/mcp-for-blender).
3. In Blender: 3D Viewport sidebar → **MCP for Blender** → **Connect to MCP server**.
4. Start Claude Code in this repository.

Telemetry is turned off in `.mcp.json` (`BLENDER_MCP_DISABLE_TELEMETRY=true`). Its tools are not pre-approved:
`execute_blender_code` runs arbitrary Python inside Blender, and `generate_3d` / `generate_gaussian_world` call
external generation services, so Claude Code asks before each use.

Cloud sessions have no Blender, so these tools report that Blender is not connected there. The repository's headless
asset pipeline (`python blender/build.py`, using `pip install bpy`; see `docs/BLENDER_ASSET_PIPELINE.md`) does not
need Blender MCP and works anywhere.

## ElevenLabs

ElevenLabs comes from the claude.ai connector, so no API key is stored in the repository. Generations spend the
account's credits. The repository's batch audio build (`npm run assets:elevenlabs`, see `docs/ELEVENLABS_AUDIO.md`)
uses its own API key from `.env`.

## Chrome DevTools

`--isolated` gives every session a throwaway browser profile; `--headless` runs it without a window. Chrome refuses
to start as root without its sandbox, so in a container run Claude Code as a non-root user or let the server find its
own Chrome (the default, as configured).
