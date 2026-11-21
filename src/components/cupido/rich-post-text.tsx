import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

const tokenPattern = /@\[([^\]]+)\]\(([0-9a-f-]{36})\)|#([\p{L}\p{N}_]+)/giu;

export function RichPostText({ text, onHashtag }: { text: string; onHashtag?: (tag: string) => void }) {
  const result: ReactNode[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(tokenPattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) result.push(text.slice(lastIndex, index));
    if (match[2]) {
      result.push(<Link key={`mention-${index}`} to="/perfil" search={{ userId: match[2] }} className="font-medium text-pink-300 hover:underline">@{match[1]}</Link>);
    } else if (match[3]) {
      const tag = `#${match[3]}`;
      result.push(onHashtag ? <button key={`tag-${index}`} type="button" onClick={() => onHashtag(tag)} className="font-medium text-fuchsia-300 hover:underline">{tag}</button> : <span key={`tag-${index}`} className="font-medium text-fuchsia-300">{tag}</span>);
    }
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) result.push(text.slice(lastIndex));
  return <>{result}</>;
}
