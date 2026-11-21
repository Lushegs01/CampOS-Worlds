# ElevenLabs audio for CampOS Worlds

The pack covers campus NPC greetings and topic responses, Sade’s briefing and delivery, and twelve Getaway effects. Dialogue follows the existing scripted choices and uses one voice per character. Getaway effects cover shots, surface impacts, a magazine change, collisions, the alarm, the fuel-drum blast, the moving police siren, and freight-yard ambience. Campus foley and the campaign music use the existing audio.

## Generate a preview

Add an ElevenLabs key with Text to Speech and Sound Effects access to the repository’s ignored `.env.local` as `ELEVENLABS_API_KEY=your_key`. Run these commands from the project directory.

```sh
npm run assets:elevenlabs -- --dry-run
npm run assets:elevenlabs -- --clip voice/sade/briefing
npm run assets:elevenlabs -- --clip sfx/freight-ambience
```

Open Sade’s briefing and enter the freight yard to listen. Once the samples sound right, render the whole pack with `npm run assets:elevenlabs`. Use `--only voice` or `--only sfx` to render one set. Generation uses ElevenLabs credits. The script reuses existing clips when the voice, text, and settings match. Rerun it after an interrupted batch to resume.

## Cast the campus voices

The default IDs are starting points. For a Nigerian English cast, audition voices in the ElevenLabs Voice Library and copy the chosen IDs into a JSON object keyed by character role. For example, save a file containing `{"sade":"VOICE_ID","vendor":"VOICE_ID"}` with the actual IDs. Pass that file with `npm run assets:elevenlabs -- --only voice --voice-map /path/to/cast.json`. Use the same file for subsequent runs to keep the casting consistent. The list of role keys is in [the dialogue inventory](../scripts/audio/dialogue-lines.mjs).

## Ship the audio

The generator writes MP3s and updates `public/assets/elevenlabs/manifest.json`. Run `npm run build` after generation so those files ship with the game. A dev preview can pick up the pack on reload. The browser loads the finished clips from the game’s asset path. The ElevenLabs key is only used by the generator.

Players can read the dialogue at any volume, replay or stop an available voice line, and control Dialogue volume in Settings. Until a clip is generated, its text is available and Getaway events use the existing effects.

[ElevenLabs Text to Speech API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert) · [ElevenLabs Sound Effects API](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert)
