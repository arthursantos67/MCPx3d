interface GenerationProgressProps {
  readonly visible: boolean;
  readonly label: string;
}

/** FE-02's "visible generation state" / FE-04's "model download/loading
 * progress shall be visible" -- a single status line above the composer. */
function GenerationProgress({ visible, label }: GenerationProgressProps) {
  if (!visible) return null;
  return (
    <p className="chat-generation-progress" role="status">
      {label}
    </p>
  );
}

export default GenerationProgress;
