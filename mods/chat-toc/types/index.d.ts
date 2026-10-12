/* chat-toc's `$.state` contract. Values here are the host's for the session:
   a hot reload keeps them, `/clear` and `/resume` reset them. The validator
   reads the members written inline under the plugin's name. */

/* A transcript file's absolute path; '' while none is known. */
export type TranscriptPath = string

declare module 'claude-code' {
  interface PluginState {
    'chat-toc': {
      /* Where the current session's transcript file is: a classic event's
         `transcript_path`, else worked out at `session.start`. */
      transcriptPath: TranscriptPath
      /* Bumped whenever what the pane draws from changed (a read finished,
         the window moved); the pane reads it to redraw. */
      rev: number
      /* Whether the person closed the pane in this session, so it does not
         open on its own again until /clear or /resume (which reset it). */
      isClosed: boolean
      /* Whether the session began by resuming or forking another, so the
         transcript can show history before its own file is written. */
      isCarriedOver: boolean
      /* Whether /chat-toc opened the pane and it has not docked since: the
         one inline placement kept rather than withdrawn. */
      isInlineAsked: boolean
      /* The Current position: the group the transcript's view is on, null
         for none. Derived in this process from what the transcript draws;
         the pane reads it to redraw the highlight. */
      currentPosition: number | null
    }
  }
}
