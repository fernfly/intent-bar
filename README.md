# Fernfly intent bar

An intent bar for web apps. A user types what they want, a small model fine-tuned on your app's API turns it into a call, and the bar shows that call as editable chips with a live preview. Your app runs it only after that, and anything that changes data asks first.

```
unpaid invoices over $500 from Europe this quarter

Invoices   status unpaid   total > $500   region Europe, all   issued this quarter
51 invoices                                        [ Email all 51 ]  [ Apply filter ↵ ]
```

- **Your app runs every call**, through your own code and with the signed-in user's permissions. The model only predicts.
- **Short queries search your pages instantly**, with no model call. Sentences go to the model.
- **Fixes teach the model.** When a user corrects a chip before running it, the bar sends the correction to your [Fernfly Studio](https://fernfly.com) project for you to review and retrain on.
- **It looks like your app.** The bar renders in Shadow DOM and takes your app's fonts and colours from its CSS.

It ships as a React component and as a script tag for apps that don't use React.

## Status

Pre-release. Nothing is published yet, and the API will change before 0.1.0.

## License

MIT
