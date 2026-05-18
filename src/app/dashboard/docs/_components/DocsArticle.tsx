import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Shared markdown render surface for every /dashboard/docs page. Carries the
// editorial styling the single-file docs page used, plus blockquote (callout),
// table, and image rules — doc pages embed captures from /docs/screenshots/.
const ARTICLE_CLASS = [
  "max-w-3xl space-y-4 text-ink-2 leading-[1.65]",
  "[&_h2]:font-serif [&_h2]:text-[22px] [&_h2]:tracking-display [&_h2]:text-ink [&_h2]:mt-8",
  "[&_h3]:font-serif [&_h3]:text-[18px] [&_h3]:text-ink [&_h3]:mt-5",
  "[&_code]:font-mono [&_code]:text-[13px] [&_code]:bg-paper-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:border [&_code]:border-rule",
  "[&_pre]:bg-paper-2 [&_pre]:border [&_pre]:border-rule [&_pre]:p-4 [&_pre]:overflow-x-auto [&_pre]:font-mono [&_pre]:text-[12px]",
  "[&_pre>code]:bg-transparent [&_pre>code]:border-0 [&_pre>code]:p-0",
  "[&_a]:text-ink [&_a]:underline hover:[&_a]:no-underline",
  "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_blockquote]:border-l-4 [&_blockquote]:border-saffron-dk [&_blockquote]:bg-paper-2 [&_blockquote]:pl-4 [&_blockquote]:pr-4 [&_blockquote]:py-3 [&_blockquote]:my-4 [&_blockquote]:text-ink",
  "[&_table]:w-full [&_table]:my-4 [&_table]:text-[13px] [&_table]:border-collapse",
  "[&_th]:border [&_th]:border-rule [&_th]:bg-paper-2 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left",
  "[&_td]:border [&_td]:border-rule [&_td]:px-2 [&_td]:py-1 [&_td]:align-top",
  "[&_img]:block [&_img]:w-full [&_img]:h-auto [&_img]:my-5 [&_img]:border [&_img]:border-rule",
  "[&_hr]:border-rule [&_hr]:my-6",
].join(" ");

export function DocsArticle({ body }: { body: string }) {
  return (
    <article className={ARTICLE_CLASS}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
    </article>
  );
}
