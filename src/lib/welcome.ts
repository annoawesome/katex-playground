/** The document a first-time visitor sees. It doubles as a feature tour. */
export const WELCOME_DOCUMENT = String.raw`\documentclass{article}
\usepackage{amsmath, amssymb, amsthm}

% Macros defined with \newcommand work inside math.
\newcommand{\R}{\mathbb{R}}
\newcommand{\abs}[1]{\left|#1\right|}

\title{Welcome to Katex Playground}
\author{You}

\begin{document}
\maketitle

\begin{abstract}
Write LaTeX on the left, see it typeset on the right. Everything is saved in
your browser automatically, and nothing is ever sent to a server.
\end{abstract}

\section{Math}
Inline math uses \(e^{i\pi} + 1 = 0\) or $a^2 + b^2 = c^2$. Display math
uses \[ \int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}. \]

Numbered equations can be referenced, like equation~\eqref{eq:triangle}:
\begin{align}
  \abs{x + y} &\leq \abs{x} + \abs{y} \label{eq:triangle} \\
  \abs{x - y} &\geq \abs{x} - \abs{y}
\end{align}

\section{Theorems}
\begin{theorem}[Archimedean property]\label{thm:arch}
  For every \(x \in \R\) there is an \(n \in \mathbb{N}\) with \(n > x\).
\end{theorem}

\begin{proof}
  Otherwise \(\mathbb{N}\) would be bounded above; see Theorem~\ref{thm:arch}.
\end{proof}

\section{Lists and text}
\begin{itemize}
  \item \textbf{Bold}, \textit{italic}, \emph{emphasis} and \texttt{code}.
  \item Footnotes\footnote{Like this one.} and \href{https://katex.org}{links}.
  \item Dashes -- and --- and ${"``"}quotes''.
\end{itemize}

\section{Try the lazy-math helper}
Put your cursor on the next line and pause: a suggestion appears below the
editor. Press Alt+Enter to accept it.

For all a in Z, a is even

x > y => x - y > 0

\end{document}
`;
