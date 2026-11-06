//! Single HTTP byte ranges for seekable local media, shared by both frontends.
#[derive(Debug, PartialEq, Eq)]
pub enum Range {
    Full,
    Partial { start: usize, end: usize },
    Unsatisfiable,
}

pub fn parse(value: Option<&str>, len: usize) -> Range {
    let Some(v) = value else { return Range::Full };
    let Some(v) = v.trim().strip_prefix("bytes=") else {
        return Range::Full;
    };
    // Multiple or malformed ranges are ignored rather than served incorrectly.
    if v.contains(',') {
        return Range::Full;
    }
    let Some((a, b)) = v.split_once('-') else {
        return Range::Full;
    };
    if a.is_empty() {
        let Ok(n) = b.parse::<usize>() else {
            return Range::Full;
        };
        if n == 0 || len == 0 {
            return Range::Unsatisfiable;
        }
        return Range::Partial {
            start: len.saturating_sub(n),
            end: len - 1,
        };
    }
    let Ok(start) = a.parse::<usize>() else {
        return Range::Full;
    };
    let end = if b.is_empty() {
        len.saturating_sub(1)
    } else {
        let Ok(n) = b.parse::<usize>() else {
            return Range::Full;
        };
        n
    };
    if len == 0 || start >= len || end < start {
        return Range::Unsatisfiable;
    }
    Range::Partial {
        start,
        end: end.min(len - 1),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ranges() {
        assert_eq!(parse(None, 10), Range::Full);
        assert_eq!(
            parse(Some("bytes=2-5"), 10),
            Range::Partial { start: 2, end: 5 }
        );
        assert_eq!(
            parse(Some("bytes=7-"), 10),
            Range::Partial { start: 7, end: 9 }
        );
        assert_eq!(
            parse(Some("bytes=-3"), 10),
            Range::Partial { start: 7, end: 9 }
        );
        assert_eq!(
            parse(Some("bytes=0-100"), 10),
            Range::Partial { start: 0, end: 9 }
        );
        assert_eq!(parse(Some("bytes=10-"), 10), Range::Unsatisfiable);
        assert_eq!(parse(Some("bytes=-0"), 10), Range::Unsatisfiable);
        assert_eq!(parse(Some("bytes=0-"), 0), Range::Unsatisfiable);
        assert_eq!(parse(Some("bytes=0-1,3-4"), 10), Range::Full);
        assert_eq!(parse(Some("bytes=no"), 10), Range::Full);
    }
}
