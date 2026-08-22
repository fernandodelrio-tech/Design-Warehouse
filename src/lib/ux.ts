import type { ComponentRole } from './types';

/**
 * How the measured components BEHAVE.
 *
 * The export could describe what a screenshot looks like and said nothing
 * about how it works. A reader rebuilding from it got the colour of a button
 * and the radius of a field and had to invent every state, every keyboard
 * path and every piece of structure underneath — which is most of what makes
 * an interface an interface rather than a picture of one.
 *
 * None of this is measured, and it does not pretend to be: a still frame has
 * exactly one state. What makes it more than boilerplate is that it is keyed
 * to the roles that WERE measured — a page with no dialog gets no dialog
 * notes — and that the states it names are spent in the measured tokens
 * rather than in colours of its own. It is the conventional half of the spec,
 * said out loud, so that the reader is not left to guess it silently.
 */

interface UxContext {
  /** The measured accent, or empty where none was found. */
  accent: string;
  /** The measured corner radius as prose, e.g. "14px". */
  radius: string;
  /** Whether any block carried a border. */
  bordered: boolean;
  /** Whether any block carried a shadow. */
  raised: boolean;
}

type Note = { heading: string; lines: string[] };

/*
   One entry per role the inventory can name. Each says what the thing is for,
   what its states are, and what has to be true underneath for it to work at
   all — the third being the part a visual spec never carries and the part
   that decides whether the rebuild is usable.
*/
function notesFor(role: string, count: number, ctx: UxContext): string[] | null {
  const { accent } = ctx;
  const press =
    'active returns the fill to its resting colour and drops any lift, so the press is felt ' +
    'rather than only seen';

  switch (role) {
    case 'top navigation':
      return [
        'Holds the identity, the primary destinations and the account. It stays put while the page moves under it — sticky, above the page in stacking order, and the same height at every breakpoint until the layout collapses.',
        'The current destination is marked by something that is not colour alone — a rule under the label, or a weight change — because a colour-only marker disappears for anyone who cannot separate the two hues.',
        'Each destination is a real link, and hover lifts the label to the strongest text level.',
        'Below the collapse width the destinations fold behind one control, and that control says whether it is open (`aria-expanded`), moves focus into the panel, and closes on Escape and on a click outside.',
      ];
    case 'sidebar navigation':
      return [
        'A persistent index of the sections. It scrolls independently of the page body, so a long list of sections never pushes the content out of reach.',
        'The current section is marked, and the marker is a shape — a filled row, a leading rule — not a hue swap.',
        'Rows are links, and the whole row is the target rather than just its text. Hover fills the row.',
        'It collapses to a drawer below the single-column breakpoint, and the trigger for that drawer follows the same open/close contract as the nav menu.',
      ];
    case 'footer':
      return [
        'The last thing on the page and the least urgent: secondary links, legal, contact. Nothing here should be the only route to anything.',
        'Links take the same underline convention as body links. Nothing in it is a primary action.',
      ];
    case 'hero':
      return [
        'The first thing read and the only place a page states what it is. One heading, one supporting line, and at most one primary action — a second primary here is two firsts, and reads as neither.',
        'It sizes to its content rather than to a fixed height, so a longer heading pushes the page down instead of overflowing.',
        `Its action is the page's primary: filled in ${accent || 'the accent'}, and the only element on the screen wearing that fill.`,
      ];
    case 'card grid':
      return [
        `${count} tiles of one kind. If the whole tile is a link, it is ONE link with one focus stop — not a heading link plus an image link plus a footer link, which makes a keyboard visit the same tile three times.`,
        'Hover raises the tile by the smallest step that reads, and the cursor changes; the tile does not move under the pointer, because a tile that moves is a tile you have to chase.',
        'The focus ring is drawn on the tile, not on the heading inside it.',
        'The grid reflows by column count, not by squeezing tiles: the tile has a minimum width and the track wraps when it no longer fits.',
        'It has an empty state and a loading state. Loading holds the tile geometry so the page does not jump when the content lands.',
      ];
    case 'data table / list':
      return [
        `${count} rows of one kind. The row is the target, not the text inside it, and the whole row highlights on hover.`,
        'A sortable column says so in its header, says which way it is sorted, and keeps that state visible after the sort — `aria-sort`, not just an arrow that appears on hover.',
        'Rows are separated by their own rule or by alternating fill, never by a gap alone, so the eye can track across a wide row.',
        'It has an empty state that says what would fill it, and it does not collapse to nothing while loading.',
        'Below the single-column breakpoint each row restacks into a labelled block rather than scrolling sideways.',
      ];
    case 'modal / dialog':
      return [
        'Takes the whole attention: the page behind it is inert, and stays scrolled where it was rather than jumping to the top.',
        'Focus moves into it when it opens and returns to whatever opened it when it closes. Tab is trapped inside it while it is open.',
        'Escape closes it, a click on the backdrop closes it, and the close control is reachable by keyboard and labelled — an X with no accessible name is a dead end for anyone not using a mouse.',
        'It is announced as a dialog (`role="dialog"`, `aria-modal`) and titled by its own heading.',
        'Where it holds a destructive action, that action is not the one focus lands on.',
      ];
    case 'tabs / segmented control':
      return [
        `${count} views of one thing, one visible at a time. The selected tab is marked by shape as well as by colour, and the mark stays legible with the hues removed.`,
        'Arrow keys move between tabs, Home and End jump to the ends, and only the selected tab is in the tab order — the panel is the next stop after it.',
        'Panels keep their own scroll position while switching, and switching does not reload the page or change the URL unless the tab is genuinely a route.',
        'It never wraps onto two lines: below the width where it would, it scrolls sideways or becomes a select.',
      ];
    case 'toolbar / filter row':
      return [
        `${count} controls acting on the content below them. Every change applies immediately — there is no Apply button — and the content updates in place rather than reloading.`,
        'What is currently filtering is visible without opening anything, and there is one clear route back to unfiltered.',
        'A filter that empties the result set says so, and says which filter did it, rather than showing an empty page.',
        'Each control is a real control: a select is a select, a toggle reports its pressed state.',
        'Any of them that opens a menu follows one contract: the trigger says whether it is open (`aria-expanded`), the panel is positioned so it never leaves the viewport — flipping above the trigger rather than being clipped — arrow keys move through the options with Home and End jumping to the ends, Escape closes it and returns focus to the trigger, and a click anywhere outside closes it too. A menu that can only be dismissed by choosing something is a trap.',
        'The row wraps rather than scrolls, and keeps its labels when it wraps.',
      ];
    case 'input / search field':
      return [
        `${count} of them. Every one has a real label — a placeholder is not a label, it disappears exactly when it is needed and is invisible to a screen reader once typing starts.`,
        'Rest carries the measured rule and hover strengthens it. Disabled drops to 45% opacity, keeps the geometry, and is never the only signal that something is unavailable.',
        'An error is stated in words next to the field, tied to it (`aria-describedby`), and marked by more than the border going red.',
        'A search field debounces rather than firing per keystroke, shows that it is working, and can be cleared in one action.',
      ];
    case 'button':
      return [
        `The action. One primary per view, filled in ${accent || 'the accent'}; everything else is quiet — a bordered or plain button that does not compete for the same attention.`,
        `Hover moves the fill AWAY from its own label rather than toward it, so the pair opens rather than closes. ${press}.`,
        'Disabled drops to 45% opacity and keeps its size, so nothing on the page moves as buttons enable and disable.',
        'A button that starts work says so while the work runs, keeps its width so the row does not reflow, and cannot be pressed twice.',
        'It is a `<button>` when it acts and an `<a>` when it navigates. The label says what happens, not "Submit".',
      ];
    case 'icon button':
      return [
        `${count} of them, and every one needs a name a screen reader can read — an icon alone is unlabelled. A tooltip is an addition to that name, not a substitute for it.`,
        'The target is at least 44×44 even where the icon is smaller, so the hit area does not depend on aiming.',
        'An icon button that toggles reports its state (`aria-pressed`), rather than only swapping its glyph.',
      ];
    case 'badge / pill':
      return [
        `${count} of them, and they are labels rather than actions — nothing here is clickable unless it is also removable, in which case the remove control is its own button with its own name.`,
        'The status a badge carries is in its text as well as its colour, so it survives being read aloud or printed in grey.',
      ];
    case 'avatar':
      return [
        `${count} of them. Each falls back to initials on a measured fill when there is no picture, and never to a broken image.`,
        'It is decorative when the name is next to it and labelled when it stands alone.',
      ];
    default:
      return null;
  }
}

/*
   A note on what is NOT here. An open menu panel is not detected, because a
   still capture almost never holds one — a dropdown is photographed shut. So
   the menu contract rides on the controls that open one (the nav's collapsed
   trigger and the toolbar's selects) rather than being claimed as a component
   in its own right. Saying "no menus were found" would be the wrong sentence:
   nothing looked for one, and a shut dropdown looks exactly like a button.
*/

/**
 * The behaviour section, written from the roles that were actually found.
 *
 * Returns an empty string where nothing was measured — a page the analyzer
 * could not read is not a page with no components, and inventing behaviour
 * notes for components nobody found would be the loudest kind of guess.
 */
export function uxNotes(roles: ComponentRole[], ctx: UxContext): string {
  const notes: Note[] = [];
  const seen = new Set<string>();
  for (const { role, count } of roles) {
    if (seen.has(role)) continue;
    seen.add(role);
    const lines = notesFor(role, count, ctx);
    if (lines) notes.push({ heading: role, lines });
  }
  if (!notes.length) return '';

  const preamble = [
    'None of this is measured — a still frame holds one state — but all of it is keyed to the ' +
      'components that WERE measured above, and every colour it spends is one of theirs. ' +
      'Treat it as the half of the design a screenshot cannot hold, rather than as decoration ' +
      'on the half it can.',
    '',
    'Across all of them: every transition is 150ms ease-out on colour and 200ms on transform, ' +
      'nothing runs longer than 250ms, and `prefers-reduced-motion` drops the lot to opacity. ' +
      'Nothing is signalled by colour alone. Every interactive element is reachable and ' +
      'operable from the keyboard in the order it is read.' +
      /*
         Said once. It was said in every role's bullets, which meant a page with
         four components carried the same forty-word sentence four times — and
         a rule repeated four times reads as four rules.
      */
      ` Focus is one rule everywhere: a 2px ring${ctx.accent ? ` in ${ctx.accent}` : ''}, offset ` +
      `2px${ctx.radius ? `, following the ${ctx.radius} corner` : ''}, drawn on top of whatever ` +
      'edge the element already has rather than replacing it.' +
      (ctx.accent
        ? ''
        : ' No accent was measured here, so that ring takes the strongest colour the palette ' +
          'does hold — it must not be the same value as the element it rings.') +
      (ctx.raised
        ? ''
        : ' Depth is not available here — nothing measured is raised — so hover and selection ' +
          'are carried by fill and by rule instead of by elevation.') +
      (ctx.bordered
        ? ''
        : ' Almost nothing is bordered either, so a control that needs an edge to be findable ' +
          'is the exception and should look like one.'),
  ];

  const body = notes.map(
    ({ heading, lines }) => `**${heading}**\n${lines.map((l) => `- ${l}`).join('\n')}`,
  );

  return [...preamble, '', body.join('\n\n')].join('\n');
}
