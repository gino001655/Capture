export default function Home() {
  return (
    <main>
      <section className="hero">
        <p className="eyebrow">Personal Capture System</p>
        <h1>Capture web foundation is ready.</h1>
        <p className="summary">
          The first runnable Web milestone is in place. Capturing and processing
          will be connected in the next vertical slice.
        </p>
        <div className="status" aria-label="Current project status">
          <span className="statusDot" aria-hidden="true" />
          Local Web foundation
        </div>
      </section>
    </main>
  );
}
