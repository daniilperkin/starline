import type { SnowflakeStepNumber } from "../entities";
import type { StepPrompt } from "./prompts";

/**
 * The prompt library in German (decision 26: full parity across the UI catalogue, the 9-step
 * prompt library and the four templates). Informal *du*, the same teaching voice as the English
 * set, and the same beats — a parity test holds the two in step. The worked examples use the
 * German titles of the same classics the English set draws on.
 */
export const STEP_PROMPTS_DE: Record<SnowflakeStepNumber, StepPrompt> = {
  1: {
    rule: "Schreib einen Satz, der die ganze Geschichte beschreibt — das große Ganze, keine Figurennamen (beschreibe stattdessen Rollen). Ziel: 15–25 Wörter.",
    examples: [
      {
        source: "Aschenputtel",
        text: "Ein verwaistes Mädchen, von der Stieffamilie als Magd gehalten, bekommt eine verzauberte Nacht, um das Herz eines Prinzen zu gewinnen — und verliert um Mitternacht einen gläsernen Schuh.",
      },
      {
        source: "Stolz und Vorurteil",
        text: "Ein stolzer Gentleman und eine scharfzüngige junge Frau müssen ihre eigenen Fehler überwinden, bevor sie sich eingestehen können, dass sie einander lieben.",
      },
      {
        source: "Frankenstein",
        text: "Ein junger Wissenschaftler erschafft ein lebendes Wesen und lässt es im Stich, und die einsame Rache der Kreatur zerstört alles, was der Wissenschaftler liebt.",
      },
    ],
    questions: [
      "Um wen geht es — als Rolle, nicht als Name?",
      "Was will diese Person mehr als alles andere?",
      "Wer oder was steht im Weg?",
      "Was steht auf dem Spiel, wenn sie scheitert?",
      "Was verändert sich in der Welt zwischen der ersten und der letzten Seite?",
      "Würde ein Fremder nach diesem Satz weiterlesen wollen?",
    ],
  },
  2: {
    rule: "Ein Absatz aus fünf Sätzen: die Ausgangslage, dann drei eskalierende Katastrophen (je eine beendet ein Viertel der Geschichte), dann das Ende.",
    examples: [
      {
        source: "Aschenputtel",
        text: "Ausgangslage: Ein Mädchen wird von seiner Stieffamilie als Magd gehalten. Katastrophe 1: Die Einladung zum königlichen Ball erreicht sie, doch sie darf nicht hin. Katastrophe 2: Eine gute Fee schickt sie trotzdem, mit Mitternacht als Frist. Katastrophe 3: Sie flieht um Mitternacht, und dem Prinzen bleibt nur ein Schuh. Ende: Der Schuh passt, und sie wird gefunden.",
      },
      {
        source: "Stolz und Vorurteil",
        text: "Ausgangslage: Eine junge Frau begegnet einem stolzen, wohlhabenden Gentleman. Katastrophe 1: Er beleidigt sie auf einem Ball. Katastrophe 2: Sie lehnt seinen Antrag ab und beschuldigt ihn, ihrer Schwester eine Chance zerstört zu haben. Katastrophe 3: Sein Brief enthüllt den Skandal ihrer eigenen Familie — und ihn als den, der ihn behebt. Ende: Beide legen Stolz und Vorurteil ab, und sie heiraten.",
      },
      {
        source: "Frankenstein",
        text: "Ausgangslage: Ein Wissenschaftler entdeckt das Geheimnis des Lebens. Katastrophe 1: Seine Kreatur entsetzt ihn, und er lässt sie im Stich. Katastrophe 2: Die Kreatur, von allen zurückgewiesen, tötet den jüngsten Bruder des Wissenschaftlers. Katastrophe 3: Sie verlangt eine Gefährtin und tötet erneut, als man sie ihr verweigert. Ende: Der Wissenschaftler stirbt bei der Verfolgung seiner Schöpfung, die um ihn trauert und verschwindet.",
      },
    ],
    questions: [
      "Wie sieht die Welt aus, bevor alles anders wird?",
      "Was ist der erste Schlag, der das Ziel dringlich macht?",
      "Wie wird es schlimmer — noch zweimal?",
      "Welche Katastrophe ist der dunkelste Wendepunkt?",
      "Wie endet es — in einem Satz?",
      "Beantwortet das Ende die Ausgangslage?",
    ],
  },
  3: {
    rule: "Eine Seite pro Hauptfigur: Name, Motivation (was sie abstrakt will), Ziel (was sie konkret verfolgt), Konflikt (was sie blockiert), Erkenntnis (was sie lernt oder wird).",
    examples: [
      {
        source: "Aschenputtel",
        text: "Motivation: als wertvoll gesehen zu werden. Ziel: ein einziges Mal zum Ball gehen. Konflikt: die Grausamkeit der Stieffamilie und ihre eigene Dienstbarkeit. Erkenntnis: Wert wird nicht von anderen verliehen — sie muss ihn selbst beanspruchen.",
      },
      {
        source: "Stolz und Vorurteil",
        text: "Motivation: aus Liebe heiraten, nicht aus Vorteil. Ziel: Mr Darcy verstehen — und von ihm verstanden werden. Konflikt: sein Stolz, ihr Vorurteil und das skandalöse Benehmen ihrer Familie. Erkenntnis: Erste Eindrücke täuschen; sie muss andere und sich selbst genauer beurteilen.",
      },
      {
        source: "Frankenstein",
        text: "Motivation: geliebt und angenommen werden. Ziel: eine Gefährtin, die aussieht wie er. Konflikt: jeder Mensch, dem er begegnet, flieht oder greift an. Erkenntnis: Er wird nie dazugehören — und wählt die Rache statt der Verzweiflung.",
      },
    ],
    questions: [
      "Was will diese Figur so sehr, dass sie dafür etwas Kostbares hergeben würde?",
      "Welches konkrete Ziel verfolgt sie auf der Seite?",
      "Wer oder was blockiert dieses Ziel?",
      "Was lernt sie bis zum Ende — oder weigert sie sich zu lernen?",
      "Wie würde sie sich selbst in einer Zeile beschreiben?",
    ],
  },
  4: {
    rule: "Erweitere jeden der fünf Sätze aus Schritt 2 zu einem Absatz. Behalte die Reihenfolge; jeder Absatz ist ein Viertel der Geschichte, und die Katastrophen sollen eskalieren.",
    examples: [
      {
        source: "Aschenputtel",
        text: "Erweiterung von „Katastrophe 2“ — der Absatz der Mitternachtsfrist: der Glanz des Ballsaals, der Tanz, den sie nie hätte haben sollen, die Uhr, die sie vergisst, bis sie schlägt, die Treppe, die sie hinunterhetzt, während Glas und Magie hinter ihr zerfallen.",
      },
      {
        source: "Stolz und Vorurteil",
        text: "Erweiterung von „Katastrophe 3“ — der Absatz des Briefs: Darcys Schilderung von Wickhams wahrem Charakter, die Enthüllung, dass er den Ruf ihrer Schwester geschützt hat, und das langsame Zerbrechen jeder Gewissheit, die Elizabeth über beide Männer hatte.",
      },
      {
        source: "Frankenstein",
        text: "Erweiterung von „Katastrophe 2“ — der Absatz danach: die Nachricht aus Genf, die Tore der Stadt bei Nacht, der Blick auf eine riesenhafte Gestalt am Tatort und Victors wachsende Gewissheit, dass seine Schöpfung seine Familie verfolgt.",
      },
    ],
    questions: [
      "Welcher Satz aus Schritt 2 lässt sich am schwersten erweitern — und warum?",
      "Endet jeder Absatz mit mehr auf dem Spiel als der vorige?",
      "Erledigt ein Absatz die Arbeit von zwei Katastrophen?",
      "Wessen Entscheidungen treiben dieses Viertel der Geschichte voran?",
      "Was hast du in Schritt 2 gestrichen, das hierher gehört hätte?",
    ],
  },
  5: {
    rule: "Eine Seite pro Hauptfigur, eine halbe pro Nebenfigur — jede aus der Perspektive dieser Figur erzählt.",
    examples: [
      {
        source: "Aschenputtel",
        text: "Der Ball, von innen erzählt: nicht „sie ging zum Ball“, sondern das geliehene Kleid, das zu gut passt, die Angst erkannt zu werden, die seltsame Rechnung zwischen bleiben wollen und fortgehen müssen.",
      },
      {
        source: "Stolz und Vorurteil",
        text: "Der erste Antrag, von Darcys Seite: seine Gewissheit, ein Geschenk zu sein, seine einstudierten Reden über ihre geringeren Verbindungen und die Fassungslosigkeit eines Mannes, der entdeckt, dass er abgelehnt werden kann.",
      },
      {
        source: "Frankenstein",
        text: "Die erste Nacht des Lebens, von der Kreatur aus: Kälte, Licht, das sticht, Hunger, der noch kein Hunger ist, und ein Schöpfer, der davonläuft — der Moment, in dem die Welt ihn lehrt, was er ist.",
      },
    ],
    questions: [
      "Was bemerkt diese Figur, das niemand sonst bemerken würde?",
      "Worin irrt sie sich — innerhalb ihrer eigenen Geschichte?",
      "Welche Szene sieht von ihrer Seite völlig anders aus?",
      "Was sagt sie nie laut?",
      "Macht diese Seite Lust, als Nächstes ihre Szenen zu schreiben?",
    ],
  },
  6: {
    rule: "Erweitere die Absätze aus Schritt 4 zu einer vierseitigen Synopsis — vier Abschnitte, jeder etwa ein Viertel des Buchs.",
    examples: [
      {
        source: "Aschenputtel",
        text: "Abschnitt 2 wächst in Nebenhandlungen hinein: die Ambitionen der Stiefmutter für ihre eigenen Töchter, die Langeweile des Prinzen mit dem Protokoll und die Gästeliste als Schlachtfeld.",
      },
      {
        source: "Stolz und Vorurteil",
        text: "Abschnitt 3 flicht die zweiten Werbungen ein: Jane und Bingleys Trennung, Wickhams Werben um Elizabeth und Lydias Durchbrennen als tiefster Punkt.",
      },
      {
        source: "Frankenstein",
        text: "Abschnitt 4 verwebt die Verfolgung: die Forderungen der Kreatur, Victors Angst in der Hochzeitsnacht, die Toten, die sich hinter ihm häufen, während er nach Norden jagt.",
      },
    ],
    questions: [
      "Welche Nebenhandlung taucht in diesem Abschnitt zuerst auf?",
      "Wo fällt die Spannung — und was hebt sie wieder?",
      "Wer entdeckt etwas, das er zu Beginn des Abschnitts noch nicht wusste?",
      "Ist das Tempo der vier Abschnitte ausgewogen?",
      "Was ist der Wendepunkt in der Mitte, in einer Zeile?",
    ],
  },
  7: {
    rule: "Baue die ausführliche Tabelle pro Figur: Aussehen, Vorgeschichte, Stimme und die freien Bibelnotizen — genug, dass jede Szene geschrieben werden kann, ohne neu zu entscheiden, wer sie sind.",
    examples: [
      {
        source: "Aschenputtel",
        text: "Stimmen-Tabelle: spricht wenig und höflich im ersten Akt, dann mit leiser Härte; die Wendungen ihrer Mutter tauchen immer wieder in ihren Sätzen auf.",
      },
      {
        source: "Stolz und Vorurteil",
        text: "Vorgeschichten-Tabelle: Darcys Erziehung, die Geschichte seiner Schwester und die genaue Form des Versprechens seines Vaters an Wickham — die Fakten hinter jeder Schroffheit seines Verhaltens.",
      },
      {
        source: "Frankenstein",
        text: "Aussehen-Tabelle: aus Teilen zusammengesetzt, acht Fuß groß, schneller und stärker als jeder Mensch — und die Sprachtabelle, die die Kreatur von Grunzen bis Milton begleitet.",
      },
    ],
    questions: [
      "Welche Felder sind für deine Hauptfigur noch leer — und müssen sie es sein?",
      "Wie klingt diese Figur, wenn sie wütend ist?",
      "Welcher einzelne Gegenstand definiert sie?",
      "Worauf verlässt sich die Handlung, dass sie es weiß?",
      "Würde ein Fremder sie allein anhand deiner Notizen erkennen?",
    ],
  },
  8: {
    rule: "Liste jede Szene auf: Perspektive, was in einer Zeile passiert, und eine geschätzte Länge. Sortiere sie in Kapitel. Diese Liste ist der Bauplan der Geschichte.",
    examples: [
      {
        source: "Aschenputtel",
        text: "Perspektive: Aschenputtel — Die Einladung kommt an und man befiehlt ihr, stattdessen den Kamin zu putzen (~800 Wörter).",
      },
      {
        source: "Stolz und Vorurteil",
        text: "Perspektive: Elizabeth — Der erste Antrag: Darcy erklärt sich und wird abgewiesen, in einer Szene, auf die die Leserschaft zwei Akte lang gewartet hat (~2.200 Wörter).",
      },
      {
        source: "Frankenstein",
        text: "Perspektive: Victor — Die Kreatur beendet ihre Erzählung und stellt ihre Forderung; das Feuer ist heruntergebrannt (~1.900 Wörter).",
      },
    ],
    questions: [
      "Welche Szene willst du am meisten schreiben?",
      "Welches Kapitel wird zu lang — und was zieht daraus weg?",
      "Ballen sich die Perspektivwechsel, oder rotieren sie Szene für Szene?",
      "Wo existiert eine Szene nur, weil die Handlung sie braucht?",
      "Landet eine Katastrophe im falschen Viertel?",
    ],
  },
  9: {
    rule: "Erweitere den Einzeiler jeder Szene zu einer mehrteiligen Synopsis: was passiert, was sich ändert und wie die Perspektivfigur die Szene anders beendet, als sie begonnen hat.",
    examples: [
      {
        source: "Aschenputtel",
        text: "Die Mitternachtsflucht wächst zu: das Schlagen der Uhr, die Panik, der verlorene Schuh, die Kutsche, die auf dem Heimweg zu Kürbissen zerfällt, und der eine gläserne Schuh, der auf der Treppe bleibt.",
      },
      {
        source: "Stolz und Vorurteil",
        text: "Die Abweisungsszene wächst zu: die misslungene Antragsrede, Elizabeths Katalog der Beschwerden, Darcys Schock und die zwei Abgänge, die beide alles neu überdenken lassen.",
      },
      {
        source: "Frankenstein",
        text: "Die Nacht der Erschaffung wächst zu: der Funke des Lebens, das sich öffnende gelbe Auge, das Zurückweichen, die Flucht ins Bett, der Traum von Elizabeth, die zur Leiche wird, und die Kreatur, die über ihm steht, als er erwacht.",
      },
    ],
    questions: [
      "Liefert die Synopsis die Katastrophe, die die Zeile aus Schritt 8 versprochen hat?",
      "Was will die Perspektivfigur, wenn sie in diese Szene geht?",
      "Was hat sich bis zum letzten Absatz geändert?",
      "Welche Szenen schreiben sich fast von selbst — und welche wehren sich?",
      "Bereit, die nächste Szene zu öffnen und sie zu entwerfen?",
    ],
  },
};
