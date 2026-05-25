# Implementation Notes

* `chatInput` is transient composer state. Submitted messages are durable conversation content.
* Daily chat already clears the input at the start of the request. Image generation did not, causing stale prompt text after results return.
* Existing image result cards already have contextual actions; the new generic assistant actions should not remove those.
