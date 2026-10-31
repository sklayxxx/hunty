//! RNNoise для голоса Hunty: кадр 480 сэмплов (10 мс при 48 кГц), значения в масштабе i16.
//! JS кладёт кадр в dn_in, зовёт dn_run (вернёт вероятность голоса 0..1), забирает dn_out.
use nnnoiseless::DenoiseState;

pub struct St {
    d: Box<DenoiseState<'static>>,
    inp: [f32; DenoiseState::FRAME_SIZE],
    out: [f32; DenoiseState::FRAME_SIZE],
}

#[no_mangle]
pub extern "C" fn dn_new() -> *mut St {
    Box::into_raw(Box::new(St { d: DenoiseState::new(), inp: [0.0; DenoiseState::FRAME_SIZE], out: [0.0; DenoiseState::FRAME_SIZE] }))
}

/// # Safety
/// `s` — указатель из dn_new
#[no_mangle]
pub unsafe extern "C" fn dn_in(s: *mut St) -> *mut f32 {
    (*s).inp.as_mut_ptr()
}

/// # Safety
/// `s` — указатель из dn_new
#[no_mangle]
pub unsafe extern "C" fn dn_out(s: *mut St) -> *mut f32 {
    (*s).out.as_mut_ptr()
}

/// # Safety
/// `s` — указатель из dn_new
#[no_mangle]
pub unsafe extern "C" fn dn_run(s: *mut St) -> f32 {
    let s = &mut *s;
    s.d.process_frame(&mut s.out, &s.inp)
}

/// # Safety
/// `s` — указатель из dn_new, после вызова не использовать
#[no_mangle]
pub unsafe extern "C" fn dn_free(s: *mut St) {
    drop(Box::from_raw(s));
}
