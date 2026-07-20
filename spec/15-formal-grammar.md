# ALP Specification — Formal Grammar

**Version:** 3.0.0
**Status:** Stable

---

## 1. Overview

This document provides the formal grammar for the Autonomous Lifecycle Protocol (ALP) version 3.0.0. The grammar is defined using **W3C EBNF** (Extended Backus-Naur Form) notation, as defined in the XML 1.0 specification.

This grammar serves as the definitive reference for parser implementers. In the event of a discrepancy between this document and the examples in the syntax specification, this document takes precedence.

---

## 2. Lexical Grammar

### 2.1 Basic Characters

```ebnf
# Newlines (LF or CRLF)
newline         ::= #x0A | #x0D #x0A

# Indentation (strictly 2 spaces per level)
indent          ::= "  "

# General whitespace (spaces only, tabs are illegal)
whitespace      ::= " "+

# Characters
letter          ::= [a-zA-Z]
digit           ::= [0-9]
printable_char  ::= [^#x00-#x1F\n]
```

### 2.2 Primitives

```ebnf
# Identifiers (kebab-case or snake_case)
identifier      ::= letter (letter | digit | "-" | "_")*

# Block Markers
block_type      ::= "project" | "workspace" | "feature" | "task" | "workflow" 
                  | "agent" | "memory" | "state" | "artifact" | "decision" 
                  | "constraint" | "verification" | "dependency" | "resource" 
                  | "event" | "goal" | "context" | "rule" | "plugin" 
                  | "type" | "policy" | "timeline" | "contract" | "vault"
                  | "macro" | "repo" | "swarm" | "package" | identifier
```

---

## 3. Syntactic Grammar

### 3.1 File Structure

```ebnf
alp_file        ::= (directive | comment | blank_line)* (block_section)*

block_section   ::= block (separator block)*

separator       ::= newline "---" newline
blank_line      ::= " "* newline
```

### 3.2 Blocks

```ebnf
block           ::= block_marker newline block_content*

block_marker    ::= "@" block_type (whitespace inline_id)?
inline_id       ::= identifier

block_content   ::= property | nested_block | comment | blank_line
```

### 3.3 Properties and Values

```ebnf
property        ::= indent_level key ":" whitespace value inline_comment? newline

key             ::= identifier
indent_level    ::= indent+

value           ::= string_val | number_val | boolean_val | null_val 
                  | date_val | duration_val | reference | status_marker 
                  | list | inline_object | multiline_val

# String Values
string_val      ::= quoted_string | unquoted_string
unquoted_string ::= printable_char (printable_char | interpolation)*
quoted_string   ::= '"' ( [^"\\] | escape_seq | interpolation )* '"'
                  | "'" ( [^'\\] | escape_seq | interpolation )* "'"
escape_seq      ::= "\" ( '"' | "\" | "n" | "t" )

# Interpolation (ALPEL expressions)
interpolation   ::= "${" whitespace? expression whitespace? "}"
expression      ::= /* See ALPEL Specification (Spec 12) */

# Numeric & Literal Values
number_val      ::= "-"? digit+ ("." digit+)?
boolean_val     ::= "true" | "false"
null_val        ::= "null"
date_val        ::= digit{4} "-" digit{2} "-" digit{2} ("T" digit{2} ":" digit{2} ":" digit{2} "Z")?
duration_val    ::= number_val ("s" | "m" | "h" | "d" | "w")
```

### 3.4 References and Status Markers

```ebnf
reference       ::= "->" whitespace (project_id "::")? identifier (whitespace "|" whitespace qualifier)?
project_id      ::= identifier
qualifier       ::= identifier

status_marker   ::= "[" (" " | "~" | "x" | "!" | "?" | "-") "]"
```

### 3.5 Complex Types

```ebnf
# Lists
list            ::= newline list_item+
list_item       ::= indent_level "-" whitespace value newline

# Inline Objects
inline_object   ::= "{" whitespace? (inline_prop ("," whitespace? inline_prop)*)? whitespace? "}"
inline_prop     ::= key ":" whitespace value

# Multi-line Values
multiline_val   ::= "|" newline (indent_level text_line newline)+
text_line       ::= (printable_char | interpolation)*

# Nested Blocks
nested_block    ::= indent_level "@" block_type (whitespace inline_id)? newline block_content*
```

### 3.6 Directives and Comments

```ebnf
directive       ::= "!" identifier ":" whitespace value newline

comment         ::= indent_level? "//" [^\n]* newline
inline_comment  ::= whitespace "//" [^\n]*
```
