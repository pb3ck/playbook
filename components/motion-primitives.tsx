'use client';

import { motion, useReducedMotion, type Variants } from 'motion/react';
import { type ReactNode } from 'react';

const easeOutExpo = [0.16, 1, 0.3, 1] as const;
const easeOutQuart = [0.25, 1, 0.5, 1] as const;

export const T = {
  fast: { duration: 0.22, ease: easeOutQuart },
  base: { duration: 0.42, ease: easeOutExpo },
  slow: { duration: 0.72, ease: easeOutExpo },
} as const;

/* ---------- FadeIn: simple fade + small lift on mount or in-view ---------- */

type FadeInProps = {
  children: ReactNode;
  delay?: number;
  y?: number;
  whenInView?: boolean;
  className?: string;
  as?: 'div' | 'section' | 'article' | 'header' | 'footer' | 'main' | 'span' | 'li';
};

export function FadeIn({
  children,
  delay = 0,
  y = 8,
  whenInView = false,
  className,
  as = 'div',
}: FadeInProps) {
  const reduce = useReducedMotion();
  const initial = reduce ? { opacity: 0 } : { opacity: 0, y };
  const animate = reduce ? { opacity: 1 } : { opacity: 1, y: 0 };
  const Comp = motion[as] as typeof motion.div;

  if (whenInView) {
    return (
      <Comp
        className={className}
        initial={initial}
        whileInView={animate}
        viewport={{ once: true, margin: '-10% 0px' }}
        transition={{ ...T.base, delay }}
      >
        {children}
      </Comp>
    );
  }

  return (
    <Comp
      className={className}
      initial={initial}
      animate={animate}
      transition={{ ...T.base, delay }}
    >
      {children}
    </Comp>
  );
}

/* ---------- Stagger: parent + child variants for list-style entries ---------- */

const staggerParent: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.06, delayChildren: 0.05 },
  },
};

const staggerChild: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: T.base },
};

export function Stagger({
  children,
  className,
  whenInView = false,
}: {
  children: ReactNode;
  className?: string;
  whenInView?: boolean;
}) {
  const reduce = useReducedMotion();
  const variants = reduce
    ? { hidden: { opacity: 0 }, visible: { opacity: 1, transition: T.fast } }
    : staggerParent;

  return (
    <motion.div
      className={className}
      variants={variants}
      initial="hidden"
      {...(whenInView
        ? { whileInView: 'visible', viewport: { once: true, margin: '-10% 0px' } }
        : { animate: 'visible' })}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
  as = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'li' | 'article' | 'section';
}) {
  const reduce = useReducedMotion();
  const Comp = motion[as] as typeof motion.div;
  const variants = reduce
    ? { hidden: { opacity: 0 }, visible: { opacity: 1 } }
    : staggerChild;
  return (
    <Comp className={className} variants={variants}>
      {children}
    </Comp>
  );
}

