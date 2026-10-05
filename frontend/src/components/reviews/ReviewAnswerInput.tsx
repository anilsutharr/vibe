import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import MathRenderer from "@/components/math-renderer";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn, preprocessMathContent, preprocessRemoveFromOptions } from "@/utils/utils";
import type { ReviewAnswer, ReviewOption, ReviewQuestion } from "@/types/review.types";

interface ReviewAnswerInputProps {
  question: ReviewQuestion;
  /** Locks the inputs once the answer has been submitted. */
  disabled?: boolean;
  /** Called with a complete answer, or null while it is still incomplete. */
  onChange: (answer: ReviewAnswer | null) => void;
}

function OptionText({ text }: { text: string }) {
  return (
    <span className="flex-1 break-words">
      <MathRenderer>{preprocessMathContent(preprocessRemoveFromOptions(text))}</MathRenderer>
    </span>
  );
}

const optionRow =
  "flex cursor-pointer items-start gap-3 rounded-xl border border-neutral-200/80 px-4 py-3 text-sm transition-colors hover:bg-neutral-50 dark:border-white/[0.08] dark:hover:bg-white/[0.04]";

/**
 * The answer controls for one review question, by type: one choice, several
 * choices, putting items in order, or a number. Produces the same answer
 * shape a quiz submits for that type.
 */
export function ReviewAnswerInput({ question, disabled, onChange }: ReviewAnswerInputProps) {
  const options = question.lotItems ?? [];

  switch (question.type) {
    case "SELECT_ONE_IN_LOT":
      return <SingleChoice options={options} disabled={disabled} onChange={onChange} />;
    case "SELECT_MANY_IN_LOT":
      return <MultipleChoice options={options} disabled={disabled} onChange={onChange} />;
    case "ORDER_THE_LOTS":
      return <Ordering key={question._id} options={options} disabled={disabled} onChange={onChange} />;
    case "NUMERIC_ANSWER_TYPE":
      return (
        <NumericAnswer
          decimalPrecision={question.decimalPrecision}
          disabled={disabled}
          onChange={onChange}
        />
      );
    default:
      return <p className="text-sm text-muted-foreground">This question type can't be reviewed yet.</p>;
  }
}

type InputProps = Pick<ReviewAnswerInputProps, "disabled" | "onChange">;

function SingleChoice({ options, disabled, onChange }: InputProps & { options: ReviewOption[] }) {
  const [selected, setSelected] = useState("");
  return (
    <RadioGroup
      value={selected}
      disabled={disabled}
      onValueChange={value => {
        setSelected(value);
        onChange(value ? { lotItemId: value } : null);
      }}
      className="grid gap-2"
    >
      {options.map(option => (
        <Label
          key={option._id}
          htmlFor={`review-option-${option._id}`}
          className={cn(optionRow, selected === option._id && "border-primary/60 bg-primary/5")}
        >
          <RadioGroupItem value={option._id} id={`review-option-${option._id}`} className="mt-0.5" />
          <OptionText text={option.text} />
        </Label>
      ))}
    </RadioGroup>
  );
}

function MultipleChoice({ options, disabled, onChange }: InputProps & { options: ReviewOption[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const toggle = (id: string, checked: boolean) => {
    const next = checked ? [...selected, id] : selected.filter(s => s !== id);
    setSelected(next);
    onChange(next.length > 0 ? { lotItemIds: next } : null);
  };
  return (
    <div className="grid gap-2">
      <p className="text-xs text-muted-foreground">Select all that apply.</p>
      {options.map(option => (
        <Label
          key={option._id}
          htmlFor={`review-option-${option._id}`}
          className={cn(optionRow, selected.includes(option._id) && "border-primary/60 bg-primary/5")}
        >
          <Checkbox
            id={`review-option-${option._id}`}
            className="mt-0.5"
            disabled={disabled}
            checked={selected.includes(option._id)}
            onCheckedChange={checked => toggle(option._id, checked === true)}
          />
          <OptionText text={option.text} />
        </Label>
      ))}
    </div>
  );
}

function Ordering({ options, disabled, onChange }: InputProps & { options: ReviewOption[] }) {
  const [order, setOrder] = useState(options);

  // Any order is a complete answer, so report the starting order straight away.
  useEffect(() => {
    onChange({ orders: order.map((item, index) => ({ order: index + 1, lotItemId: item._id })) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order]);

  const move = (from: number, to: number) => {
    const next = [...order];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setOrder(next);
  };

  return (
    <div className="grid gap-2">
      <p className="text-xs text-muted-foreground">Put the items in the correct order, first at the top.</p>
      <ol className="grid gap-2">
        {order.map((item, index) => (
          <li
            key={item._id}
            className="flex items-center gap-3 rounded-xl border border-neutral-200/80 px-3 py-2 text-sm dark:border-white/[0.08]"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums">
              {index + 1}
            </span>
            <OptionText text={item.text} />
            <div className="flex shrink-0 gap-1">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                aria-label={`Move "${item.text}" up`}
                disabled={disabled || index === 0}
                onClick={() => move(index, index - 1)}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                aria-label={`Move "${item.text}" down`}
                disabled={disabled || index === order.length - 1}
                onClick={() => move(index, index + 1)}
              >
                <ArrowDown className="h-4 w-4" />
              </Button>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function NumericAnswer({
  decimalPrecision,
  disabled,
  onChange,
}: InputProps & { decimalPrecision?: number }) {
  const [text, setText] = useState("");
  return (
    <div className="grid max-w-xs gap-2">
      <Label htmlFor="review-numeric-answer">Your answer</Label>
      <Input
        id="review-numeric-answer"
        type="number"
        inputMode="decimal"
        step={decimalPrecision ? 1 / 10 ** decimalPrecision : "any"}
        value={text}
        disabled={disabled}
        onChange={event => {
          setText(event.target.value);
          const value = Number(event.target.value);
          onChange(event.target.value.trim() !== "" && Number.isFinite(value) ? { value } : null);
        }}
      />
      {decimalPrecision !== undefined && decimalPrecision > 0 && (
        <p className="text-xs text-muted-foreground">
          Rounded to {decimalPrecision} decimal place{decimalPrecision === 1 ? "" : "s"}.
        </p>
      )}
    </div>
  );
}
