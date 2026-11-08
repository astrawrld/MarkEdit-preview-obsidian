---
tags: [demo]
---
# Obsidian syntax demo #demo

Text with ==highlight==, a #tag, #nested/tag, and a comment that's hidden: %%secret%%.

A paragraph you can link to. ^para-1

Jump to [[#^para-1|that paragraph]] or [[#Callouts]]. Note link (handled by MarkEdit-wikilinks): [[Other Note|alias]].

%%
This whole block is hidden.
%%

## Callouts

> [!NOTE]
> GitHub-style still works.

> [!info] Custom **title**
> Info body.

> [!faq]- Collapsed by default
> You found me.

> [!example]+ Expanded foldable
> - one
> - two

> [!bug] Nested
> > [!quote] Inner quote
> > Words.

> [!abstract]
> [!todo]

> [!success] Title only

> [!danger] Danger

> [!question] Question

## Embeds

![[Some Note]]

Math $e^{i\pi}+1=0$ and footnote[^1].

[^1]: Footnote text.
