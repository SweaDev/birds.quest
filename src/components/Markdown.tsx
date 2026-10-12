import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";

// Everything rendered from Markdown goes through rehype-sanitize (default GitHub-like schema):
// no scripts, event handlers or javascript: URLs. Raw HTML is not parsed at all.
export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      rehypePlugins={[rehypeSanitize]}
      components={{
        a: ({ href, children: label }) => (
          <a href={href} target="_blank" rel="noopener noreferrer nofollow">
            {label}
          </a>
        ),
        // Plain <img>: sources are Wikimedia URLs allowed by the CSP, no optimiser needed.
        // eslint-disable-next-line @next/next/no-img-element
        img: ({ src, alt }) => <img src={typeof src === "string" ? src : undefined} alt={alt ?? ""} loading="lazy" />,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
