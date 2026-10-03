#!/usr/bin/env perl
# Rewrites claude-hud statusline output on the way to the terminal.
#
# claude-hud hardcodes several things this setup does not want: square brackets
# around the model badge, a "git:( )" wrapper around the branch, and a " | "
# before every segment including the --extra-cmd label. It also strips ANSI from
# extra-cmd output, so hud-pace.sh cannot colour itself.
#
# Rewriting the rendered line keeps all of that out of the plugin, which lives in
# an auto-updating cache directory and would lose local edits on every release.
use strict;
use warnings;
use utf8;

binmode(STDIN, ':encoding(UTF-8)');
binmode(STDOUT, ':encoding(UTF-8)');

my $home = $ENV{HOME};
my $green = "\e[0m\e[32m";
my $red = "\e[0m\e[31m";
# Light grey rather than dim, which rendered too faint to read as a divider.
# Separators always follow a segment reset, so a plain reset after is safe.
my $dot = "\e[38;5;250m·\e[0m";

my $out = do { local $/; <STDIN> };

# Model badge: keep the colour, drop the brackets. First match only, so the
# agent lines underneath keep their own [model] labels.
$out =~ s/(\e\[[\d;]*m)\[([^\[\]]*)\]/$1$2/;

# "Opus 5 (1M context)" -> "Opus 5 1m". claude-hud's compact model format drops
# the window size altogether, which is the part worth keeping.
$out =~ s/\((\d+[KM]) context\)/lc $1/e;

# Branch: "git:(main*)" -> "main*".
$out =~ s/git:\((.*?)\)/$1/;

# Absolute project path -> "~/dev/coilbox", matching the shell prompt.
$out =~ s/\Q$home\E/~/g if defined $home && length $home;

# claude-hud appends the --extra-cmd label as a trailing segment of its own,
# which reads as unrelated to the usage figures and pushes the line onto a
# second row. Lift the label out and put each window's pace beside the window
# it describes, so "5h: 75% (29m)" becomes "5h: 75% (29m) +16".
my %pace;
if ($out =~ s/(?:[ ]*\|[ ]*|\n)?(?:\e\[[\d;]*m)*pace ([^\e\n]*)(?:\e\[[\d;]*m)*//) {
	my $label = $1;
	while ($label =~ /(\d+[hd])[ ]+([+-]?\d+)/g) {
		$pace{$1} = $2;
	}
}

my @unplaced;
for my $window (sort keys %pace) {
	my $delta = colour_delta($pace{$window});
	next if $out =~ s/(\Q$window\E:(?:(?!\|).)*?\([^)]*\))/$1 . $delta/e;
	next if $out =~ s/(\Q$window\E:(?:(?!\|).)*?\d+%)/$1 . $delta/e;
	push @unplaced, $window;
}

# No usage segment to attach to, so keep the label rather than lose the reading.
if (@unplaced) {
	my $tail = '  pace ' . join(' · ', map { $_ . colour_delta($pace{$_}) } @unplaced);
	$out =~ s/(\n|\z)/$tail$1/;
}

# Effort reads as another field, not as a gauge, so the dial glyph becomes a
# separator: "Opus 5 ◑ high" -> "Opus 5 · high".
# This dot sits inside the model badge, so it takes the badge colour rather
# than the grey used between segments.
$out =~ s/(?:○|◔|◑|◕|●) (?=(?:low|medium|high|xhigh|max)\b)/· /;

# claude-hud keeps the context bar attached to the model badge with no divider.
$out =~ s/\b((?:low|medium|high|xhigh|max)\b(?:\e\[[\d;]*m)*) /$1 $dot /;

# Segment separator. Runs last because the pace lift above matches on " | ".
$out =~ s/ \| / $dot /g;

# Push the usage figures to the right edge. claude-hud measures the line before
# any of the trimming above, so it can also wrap a line that now fits: when the
# usage block has been pushed onto a second row, pull it back up.
my $cols = $ENV{COLUMNS};
if (defined $cols && $cols =~ /^\d+$/ && $cols > 20) {
	my @lines = split /\n/, $out, -1;
	my $usage_start = qr/(?:\e\[[\d;]*m)*(?:5h|7d):/;
	my ($left, $usage, $wrapped);

	if (@lines && $lines[0] =~ /^(.*?)[ ]\Q$dot\E[ ]($usage_start.*)$/) {
		($left, $usage) = ($1, $2);
	} elsif (@lines > 1 && $lines[1] =~ /^($usage_start.*)$/) {
		($left, $usage) = ($lines[0], $1);
		$wrapped = 1;
	}

	# A wrap can also fall between the two windows, leaving 7d on its own row.
	if (defined $usage && !$wrapped && @lines > 1 && $lines[1] =~ /^($usage_start.*)$/) {
		$usage .= " $dot " . $1;
		$wrapped = 1;
	}

	if (defined $usage) {
		my $pad = $cols - visible_width($left) - visible_width($usage);
		if ($pad >= 2) {
			splice(@lines, 1, 1) if $wrapped;
			$lines[0] = $left . (' ' x $pad) . $usage;
			$out = join "\n", @lines;
		}
	}
}

print $out;

# Printable width, ignoring the colour escapes.
sub visible_width {
	my ($text) = @_;
	$text =~ s/\e\[[\d;]*m//g;
	return length $text;
}

# Green when there is quota to spare, red when burning it too fast.
sub colour_delta {
	my ($value) = @_;
	return ' ' . ($value =~ /^-/ ? $red : $green) . $value . "\e[0m";
}
