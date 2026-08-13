import { CaptureForm } from "./capture-form";

export default function Home() {
  return (
    <main>
      <section className="intro">
        <p className="eyebrow">Personal Capture System</p>
        <h1>Get it out of your head.</h1>
        <p className="summary">
          Send one piece of content through the local API and Desktop worker.
          Permanent storage comes later.
        </p>
        <div className="status" aria-label="Current project status">
          <span className="statusDot" aria-hidden="true" />
          Local Web + API + Desktop
        </div>
      </section>
      <CaptureForm />
    </main>
  );
}
