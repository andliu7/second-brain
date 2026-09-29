import { describe, expect, it } from 'vitest';
import { escapeLatex, parseLatexResume, resumeToLatex } from '../src/lib/latex-resume';
import type { Resume } from '../src/types';

// A resume in the shape of Jake Gutierrez's template, written for this test (not copied from it): the
// preamble a student's Overleaf copy carries, the centred header with \href links, \resumeSubheading
// for education and experience (with Jake's argument order, role first for a job), a second role under
// one company, \resumeProjectHeading, a Technical Skills block of \textbf labels, comments, \vspace
// scaffolding, and the escaped characters \&, \%, \$ and \_.
const JAKE = String.raw`%-------------------------
% Resume in LaTeX, based on a common student template
%-------------------------
\documentclass[letterpaper,11pt]{article}
\usepackage{latexsym}
\usepackage[empty]{fullpage}
\usepackage{titlesec}
\usepackage[hidelinks]{hyperref}
\newcommand{\resumeItem}[1]{\item\small{{#1 \vspace{-2pt}}}}
\newcommand{\resumeSubheading}[4]{\vspace{-2pt}\item\begin{tabular*}{0.97\textwidth}[t]{l@{\extracolsep{\fill}}r}\textbf{#1} & #2 \\ \textit{\small#3} & \textit{\small #4} \\ \end{tabular*}\vspace{-7pt}}
\newcommand{\resumeSubHeadingListStart}{\begin{itemize}[leftmargin=0.15in, label={}]}
\newcommand{\resumeSubHeadingListEnd}{\end{itemize}}
\newcommand{\resumeItemListStart}{\begin{itemize}}
\newcommand{\resumeItemListEnd}{\end{itemize}\vspace{-5pt}}

\begin{document}

%----------HEADING----------
\begin{center}
    \textbf{\Huge \scshape Priya Raman} \\ \vspace{1pt}
    \small (301) 555-0142 $|$ \href{mailto:priya.raman@example.edu}{\underline{priya.raman@example.edu}} $|$
    \href{https://www.linkedin.com/in/priyaraman}{\underline{linkedin.com/in/priyaraman}} $|$
    \href{https://github.com/praman}{\underline{github.com/praman}}
\end{center}

%-----------EDUCATION-----------
\section{Education}
  \resumeSubHeadingListStart
    \resumeSubheading
      {University of Maryland}{College Park, MD}
      {B.S. in Computer Science, Minor in Statistics}{Aug. 2023 -- May 2027}
      \resumeItemListStart
        \resumeItem{GPA: 3.8/4.0, Dean's List (top 10\%)}
      \resumeItemListEnd
  \resumeSubHeadingListEnd

%-----------EXPERIENCE-----------
\section{Experience}
  \resumeSubHeadingListStart

    \resumeSubheading
      {Software Engineering Intern}{June 2025 -- Aug. 2025}
      {Chesapeake Data \& Analytics}{Baltimore, MD}
      \resumeItemListStart
        \resumeItem{Cut the nightly ETL job from 40 to 12 minutes by batching writes in \textbf{PostgreSQL}}
        \resumeItem{Saved the team \$4,000 a year by retiring an unused \texttt{cron\_runner} service}
      \resumeItemListEnd

    \resumeSubSubheading
      {Data Analyst Intern}{Jan. 2025 -- May 2025}
      \resumeItemListStart
        \resumeItem{Built dashboards in \emph{Tableau} for 3 regional teams}
      \resumeItemListEnd

    \resumeSubheading
      {Teaching Assistant}{Sept. 2024 -- Present}
      {Department of Computer Science}{College Park, MD}
      \resumeItemListStart
        \resumeItem{Ran weekly office hours for 200+ students in CMSC 131}
      \resumeItemListEnd

  \resumeSubHeadingListEnd

%-----------PROJECTS-----------
\section{Projects}
    \resumeSubHeadingListStart
      \resumeProjectHeading
          {\textbf{Mechanism Trainer} $|$ \emph{React, TypeScript, RDKit}}{Jan. 2026 -- Present}
          \resumeItemListStart
            \resumeItem{Drills organic chemistry mechanisms with arrow-pushing checks}
          \resumeItemListEnd
      \resumeProjectHeading
          {\textbf{Shell\_Scripts}}{2024}
    \resumeSubHeadingListEnd

%-----------PROGRAMMING SKILLS-----------
\section{Technical Skills}
 \begin{itemize}[leftmargin=0.15in, label={}]
    \small{\item{
     \textbf{Languages}{: Java, Python, C/C++, SQL, JavaScript, R} \\
     \textbf{Frameworks}{: React, Flask, JUnit} \\
     \textbf{Developer Tools}{: Git, Docker, VS Code}
    }}
 \end{itemize}

\end{document}
`;

describe('reading a Jake-style LaTeX resume', () => {
  const { resume, unread } = parseLatexResume(JAKE);
  it('reads the name, and the contact line by kind: email from mailto, phone, links by their text', () => {
    expect(resume.profile).toEqual({ name: 'Priya Raman', email: 'priya.raman@example.edu', phone: '(301) 555-0142', location: '', links: ['linkedin.com/in/priyaraman', 'github.com/praman'] });
  });
  it('reads education with the school first, and dates as dates (-- is an en dash), whatever column they are in', () => {
    expect(resume.education).toHaveLength(1);
    expect(resume.education[0]).toMatchObject({ title: 'University of Maryland', subtitle: 'B.S. in Computer Science, Minor in Statistics', date: 'Aug. 2023 \u2013 May 2027', location: 'College Park, MD' });
    expect(resume.education[0].bullets).toEqual(["GPA: 3.8/4.0, Dean's List (top 10%)"]);
  });
  it('reads experience the way Jake orders it (role, dates, company, place), a second role under the same company, and the escapes', () => {
    expect(resume.experience.map(e => [e.title, e.subtitle, e.date, e.location])).toEqual([
      ['Chesapeake Data & Analytics', 'Software Engineering Intern', 'June 2025 \u2013 Aug. 2025', 'Baltimore, MD'],
      ['Chesapeake Data & Analytics', 'Data Analyst Intern', 'Jan. 2025 \u2013 May 2025', ''],
      ['Department of Computer Science', 'Teaching Assistant', 'Sept. 2024 \u2013 Present', 'College Park, MD'],
    ]);
    expect(resume.experience[0].bullets).toEqual(['Cut the nightly ETL job from 40 to 12 minutes by batching writes in PostgreSQL', 'Saved the team $4,000 a year by retiring an unused cron_runner service']);
    expect(resume.experience[1].bullets).toEqual(['Built dashboards in Tableau for 3 regional teams']);
  });
  it('reads projects: the name and tech either side of the bar, the date, and a project with no tech', () => {
    expect(resume.projects.map(p => [p.title, p.subtitle, p.date, p.bullets.length])).toEqual([
      ['Mechanism Trainer', 'React, TypeScript, RDKit', 'Jan. 2026 \u2013 Present', 1],
      ['Shell_Scripts', '', '2024', 0],
    ]);
  });
  it('reads the skills block into one line per label, and has nothing it could not read', () => {
    expect(resume.skills).toEqual(['Languages: Java, Python, C/C++, SQL, JavaScript, R', 'Frameworks: React, Flask, JUnit', 'Developer Tools: Git, Docker, VS Code']);
    expect(unread).toEqual([]);
  });
});

// Anything else built from \section and lists: no template commands at all.
const PLAIN = String.raw`\documentclass{article}
\usepackage{fontawesome5}
\begin{document}
\begin{center}
{\LARGE Sam Okafor}\\
Silver Spring, MD \quad \faEnvelope\ \href{mailto:sam@example.com}{Email} \quad \url{sam.dev}
\end{center}

\section*{Experience}
\textbf{Blue Crab Robotics} \hfill Summer 2025 \\
\textit{Firmware Intern} \hfill Remote
\begin{itemize}
  \item Wrote the motor driver in C, 30\% less jitter
  \item Reviewed pull requests
\end{itemize}

\section{Leadership}
\begin{itemize}
  \item \textbf{Robotics Club, President} \hfill 2024 -- 2025
  \begin{itemize}
    \item Grew the club from 12 to 40 members
    \begin{itemize}
      \item Ran the spring recruiting fair
    \end{itemize}
  \end{itemize}
  \item \textbf{Hackathon Organizer} | Terp Hacks \hfill 2023
\end{itemize}

\section{Skills}
\begin{itemize}
  \item[Languages] C, Python
  \item Tools: KiCad, Git
\end{itemize}

\section{Awards}
Dean's List, Fall 2024 \\ \mysterymacro{First place}, Bitcamp 2025

\end{document}`;

describe('reading any other resume built from \\section and itemize', () => {
  const { resume, unread } = parseLatexResume(PLAIN);
  it('reads a header without separators: the name, a location, an email whose link text is a word, a \\url', () => {
    expect(resume.profile).toEqual({ name: 'Sam Okafor', email: 'sam@example.com', phone: '', location: 'Silver Spring, MD', links: ['sam.dev'] });
  });
  it('a loose "title \\hfill date" line is an entry and the list under it its bullets; Leadership counts as experience', () => {
    expect(resume.experience.map(e => [e.title, e.subtitle, e.date, e.location])).toEqual([
      ['Blue Crab Robotics', 'Firmware Intern', 'Summer 2025', 'Remote'],
      ['Robotics Club, President', '', '2024 \u2013 2025', ''],
      ['Hackathon Organizer', 'Terp Hacks', '2023', ''],
    ]);
    expect(resume.experience[0].bullets).toEqual(['Wrote the motor driver in C, 30% less jitter', 'Reviewed pull requests']);
  });
  it('nested items are bullets of the item above them, however deep', () => {
    expect(resume.experience[1].bullets).toEqual(['Grew the club from 12 to 40 members', 'Ran the spring recruiting fair']);
    expect(resume.experience[2].bullets).toEqual([]);
  });
  it('skills from \\item[label] and plain items', () => {
    expect(resume.skills).toEqual(['Languages: C, Python', 'Tools: KiCad, Git']);
  });
  it('says what it could not read: the section with no place, and the unknown commands kept as text', () => {
    expect(unread).toHaveLength(2);
    expect(unread[0]).toBe(`The Awards section has no place in this resume, so it was left out: "Dean's List, Fall 2024 First place, Bitcamp 2025".`);
    expect(unread[1]).toBe('Commands this reader does not know, kept as their text: \\faEnvelope, \\mysterymacro.');
  });
  it('a file with no sections reads the header and says so; a file with no document environment is read whole', () => {
    const header = parseLatexResume(String.raw`\begin{center}Ada Lovelace \\ ada@example.org $|$ London\end{center}`);
    expect(header.resume.profile).toMatchObject({ name: 'Ada Lovelace', email: 'ada@example.org', location: 'London' });
    expect(header.unread).toEqual(['No \\section headings were found, so only the name and contact line were read.']);
  });
});

describe('escaping and writing LaTeX', () => {
  it('escapes the special characters, a backslash included, and writes dashes back as -- and ---', () => {
    expect(escapeLatex('R&D, 10% of $5, a_b, #1, {x}, ~, ^, \\, <>, |')).toBe('R\\&D, 10\\% of \\$5, a\\_b, \\#1, \\{x\\}, \\textasciitilde{}, \\textasciicircum{}, \\textbackslash{}, \\textless{}\\textgreater{}, \\textbar{}');
    expect(escapeLatex('2024 \u2013 2025 \u2014 now')).toBe('2024 -- 2025 --- now');
  });
  it('a resume written out and read back comes back the same, every field, specials included', () => {
    const resume: Resume = {
      profile: { name: 'Ada Example', email: 'ada@example.com', phone: '(555) 555-0100', location: 'College Park, MD', links: ['github.com/ada', 'https://ada.dev/p?id=1#top'] },
      education: [{ id: 'e1', title: 'University of Maryland', subtitle: 'B.S. Computer Science', date: 'Aug 2023 \u2013 May 2027', location: 'College Park, MD', bullets: ['GPA 3.9', 'Coursework: CMSC 351 & 420'] }],
      experience: [
        { id: 'x1', title: 'Acme & Sons', subtitle: 'Intern', date: 'Summer', location: 'Remote', bullets: ['Cut costs 30% ($12k)', 'Wrote snake_case tools'] },
        { id: 'x2', title: 'Library', subtitle: 'Student Worker', date: '2024', location: '', bullets: [] },
      ],
      projects: [{ id: 'p1', title: 'Second Brain', subtitle: 'React, TypeScript', date: '2026', location: '', bullets: ['Notes, PDFs and a resume'] }, { id: 'p2', title: 'Tiny', subtitle: '', date: '', location: '', bullets: [] }],
      skills: ['Languages: Python, Java, C#', 'Git and Docker'],
      template: 'onyx',
    };
    const tex = resumeToLatex(resume);
    expect(tex).toContain('\\begin{document}');
    expect(tex).toContain('\\resumeSubheading\n      {Intern}{Summer}\n      {Acme \\& Sons}{Remote}');
    expect(tex).toContain('\\href{https://ada.dev/p?id=1\\#top}{\\underline{https://ada.dev/p?id=1\\#top}}');
    expect(tex).toContain('\\textbf{Languages}{: Python, Java, C\\#}');
    const back = parseLatexResume(tex);
    expect(back.unread).toEqual([]);
    const strip = (r: Resume) => ({ ...r, template: undefined, education: r.education.map(({ id: _id, ...e }) => e), experience: r.experience.map(({ id: _id, ...e }) => e), projects: r.projects.map(({ id: _id, ...e }) => e) });
    expect(strip(back.resume)).toEqual(strip(resume));
  });
  it('an empty resume is still a complete file, with no empty sections', () => {
    const tex = resumeToLatex({ profile: { name: '', email: '', phone: '', location: '', links: [] }, education: [], experience: [], projects: [], skills: [] });
    expect(tex).toMatch(/\\begin\{document\}[\s\S]*\\end\{document\}\n$/);
    expect(tex).not.toContain('\\section{');
  });
});
